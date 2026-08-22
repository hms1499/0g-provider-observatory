// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Auth} from "../Auth.sol";
import {ProviderRegistry} from "../ProviderRegistry.sol";
import {MeasurementRegistry} from "../MeasurementRegistry.sol";

contract MeasurementRegistryTest is Test {
    ProviderRegistry reg;
    MeasurementRegistry mr;

    address constant OWNER = address(0xA11CE);
    address constant PROBER = address(0xB0B);
    address constant PROBER2 = address(0xC0FFEE);
    address constant OUTSIDER = address(0xDEAD);

    uint32 constant HOUR = 3600;
    bytes32 constant ROOT = bytes32(uint256(0xBEEF));

    /// The real network shape on 2026-08-21: 38 healthy chatbot services.
    uint16 constant NETWORK_SIZE = 38;

    function setUp() public {
        reg = new ProviderRegistry(OWNER);
        mr = new MeasurementRegistry(OWNER, reg, HOUR);

        vm.startPrank(OWNER);
        reg.setAuthorized(PROBER, true);
        mr.setAuthorized(PROBER, true);
        mr.setAuthorized(PROBER2, true);
        vm.stopPrank();

        vm.startPrank(PROBER);
        for (uint16 i = 0; i < NETWORK_SIZE; ++i) {
            reg.register(
                address(uint160(0x1000 + i)),
                string.concat("model-", vm.toString(i)),
                ProviderRegistry.Mode.TeeTLS
            );
        }
        vm.stopPrank();

        vm.warp(1_787_000_000);
    }

    function _items(uint16 n) internal pure returns (MeasurementRegistry.Measurement[] memory a) {
        a = new MeasurementRegistry.Measurement[](n);
        for (uint16 i = 0; i < n; ++i) {
            a[i] = MeasurementRegistry.Measurement({
                providerId: i + 1,
                p50Ms: 3080 + i,
                p95Ms: 9408 + i,
                errorRateBps: 125,
                divergenceBps: 340,
                calls: 15,
                observedMode: uint8(ProviderRegistry.Mode.TeeTLS)
            });
        }
    }

    // ── the property the whole contract exists for ────────────────────────────

    function test_epochIsWriteOnce() public {
        vm.startPrank(PROBER);
        mr.writeEpoch(ROOT, _items(3));

        uint32 e = mr.currentEpoch();
        vm.expectRevert(
            abi.encodeWithSelector(MeasurementRegistry.AlreadyWritten.selector, e, PROBER)
        );
        mr.writeEpoch(ROOT, _items(3));
        vm.stopPrank();
    }

    function test_writeOnceHoldsEvenForTheOwner() public {
        vm.prank(PROBER);
        mr.writeEpoch(ROOT, _items(2));

        // The owner can authorise itself but still cannot rewrite the epoch.
        vm.prank(OWNER);
        mr.setAuthorized(OWNER, true);

        uint32 e = mr.currentEpoch();
        vm.prank(OWNER);
        mr.writeEpoch(ROOT, _items(2)); // OWNER writing its OWN slot is fine
        assertTrue(mr.isWritten(e, OWNER));

        // ...but PROBER's record is untouched and still unrewritable.
        vm.prank(OWNER);
        vm.expectRevert();
        this.rewriteAs(PROBER, e);
    }

    function rewriteAs(address who, uint32) external {
        vm.prank(who);
        mr.writeEpoch(ROOT, _items(2));
    }

    function test_newEpochBecomesWritableAfterTimePasses() public {
        vm.startPrank(PROBER);
        mr.writeEpoch(ROOT, _items(3));
        uint32 first = mr.currentEpoch();

        vm.warp(block.timestamp + HOUR);
        mr.writeEpoch(ROOT, _items(3));
        vm.stopPrank();

        assertEq(mr.currentEpoch(), first + 1);
        assertEq(mr.epochCountOf(PROBER), 2);
    }

    // ── epochs are a pure function of time ────────────────────────────────────

    function test_epochOfIsPureFunctionOfTime() public view {
        assertEq(mr.epochOf(0), 0);
        assertEq(mr.epochOf(HOUR - 1), 0);
        assertEq(mr.epochOf(HOUR), 1);
        assertEq(mr.epochOf(HOUR * 5 + 17), 5);
    }

    /// Two probers with no coordination land in the same epoch and both records survive.
    function test_twoProbersShareOneEpochIndependently() public {
        vm.prank(PROBER);
        mr.writeEpoch(ROOT, _items(3));
        vm.prank(PROBER2);
        mr.writeEpoch(bytes32(uint256(0xFEED)), _items(5));

        uint32 e = mr.currentEpoch();
        assertEq(mr.getHeader(e, PROBER).count, 3);
        assertEq(mr.getHeader(e, PROBER2).count, 5);
        assertEq(mr.getHeader(e, PROBER2).storageRoot, bytes32(uint256(0xFEED)));
    }

    // ── round trip ────────────────────────────────────────────────────────────

    function test_roundTripsFullNetwork() public {
        vm.prank(PROBER);
        mr.writeEpoch(ROOT, _items(NETWORK_SIZE));

        uint32 e = mr.currentEpoch();
        MeasurementRegistry.EpochHeader memory h = mr.getHeader(e, PROBER);
        assertEq(h.prober, PROBER);
        assertEq(h.count, NETWORK_SIZE);
        assertEq(h.storageRoot, ROOT);
        assertEq(h.writtenAt, block.timestamp);

        MeasurementRegistry.Measurement[] memory got = mr.getMeasurements(e, PROBER);
        assertEq(got.length, NETWORK_SIZE);
        assertEq(got[0].providerId, 1);
        assertEq(got[0].p50Ms, 3080);
        assertEq(got[NETWORK_SIZE - 1].p95Ms, 9408 + NETWORK_SIZE - 1);
        assertEq(got[NETWORK_SIZE - 1].calls, 15);
    }

    // ── guards ────────────────────────────────────────────────────────────────

    function test_revertsForUnauthorizedProber() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(Auth.NotAuthorized.selector);
        mr.writeEpoch(ROOT, _items(1));
    }

    /// A summary with no path back to its evidence is an opinion with gas attached.
    function test_revertsWithoutStorageRoot() public {
        vm.prank(PROBER);
        vm.expectRevert(MeasurementRegistry.MissingStorageRoot.selector);
        mr.writeEpoch(bytes32(0), _items(1));
    }

    function test_revertsOnEmptyEpoch() public {
        vm.prank(PROBER);
        vm.expectRevert(MeasurementRegistry.EmptyEpoch.selector);
        mr.writeEpoch(ROOT, new MeasurementRegistry.Measurement[](0));
    }

    function test_revertsOnUnregisteredProviderId() public {
        MeasurementRegistry.Measurement[] memory a = _items(1);
        a[0].providerId = NETWORK_SIZE + 1;
        vm.prank(PROBER);
        vm.expectRevert(
            abi.encodeWithSelector(
                MeasurementRegistry.UnknownProvider.selector, NETWORK_SIZE + 1
            )
        );
        mr.writeEpoch(ROOT, a);

        a[0].providerId = 0;
        vm.prank(PROBER);
        vm.expectRevert(
            abi.encodeWithSelector(MeasurementRegistry.UnknownProvider.selector, uint16(0))
        );
        mr.writeEpoch(ROOT, a);
    }

    function test_revertsOnDuplicateProviderInOneEpoch() public {
        MeasurementRegistry.Measurement[] memory a = _items(3);
        a[2].providerId = a[0].providerId;
        vm.prank(PROBER);
        vm.expectRevert(
            abi.encodeWithSelector(MeasurementRegistry.DuplicateProvider.selector, a[0].providerId)
        );
        mr.writeEpoch(ROOT, a);
    }

    function test_readingAnUnwrittenEpochReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(MeasurementRegistry.EpochNotWritten.selector, uint32(1), PROBER)
        );
        mr.getHeader(1, PROBER);
    }

    /// Services that could not be measured are absent, never zero-filled.
    function test_unmeasuredServicesAreAbsentNotZero() public {
        vm.prank(PROBER);
        mr.writeEpoch(ROOT, _items(NETWORK_SIZE - 3)); // 3 unreachable, as on the real network

        uint32 e = mr.currentEpoch();
        assertEq(mr.getMeasurements(e, PROBER).length, NETWORK_SIZE - 3);
        assertEq(reg.providerCount(), NETWORK_SIZE);
        // A reader derives "not measured" from registry minus epoch — 3 services.
    }

    function test_enumeratesProberHistoryWithoutLogs() public {
        vm.startPrank(PROBER);
        for (uint256 i = 0; i < 4; ++i) {
            mr.writeEpoch(ROOT, _items(2));
            vm.warp(block.timestamp + HOUR);
        }
        vm.stopPrank();

        uint32[] memory epochs = mr.epochsOf(PROBER);
        assertEq(epochs.length, 4);
        assertEq(epochs[3], epochs[0] + 3);
    }

    // ── cost ──────────────────────────────────────────────────────────────────

    /// The number that decides how many epochs fit in the $10-15 budget.
    function test_gasForOneFullEpoch() public {
        MeasurementRegistry.Measurement[] memory a = _items(NETWORK_SIZE);
        vm.prank(PROBER);
        uint256 before = gasleft();
        mr.writeEpoch(ROOT, a);
        uint256 used = before - gasleft();

        emit log_named_uint("gas: one epoch, 38 services", used);
        emit log_named_uint("gas per measurement", used / NETWORK_SIZE);
        assertLt(used, 1_500_000, "one epoch must stay well under a block");
    }
}
