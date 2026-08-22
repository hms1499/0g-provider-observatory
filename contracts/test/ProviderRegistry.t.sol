// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Auth} from "../Auth.sol";
import {ProviderRegistry} from "../ProviderRegistry.sol";

contract ProviderRegistryTest is Test {
    ProviderRegistry reg;

    address constant OWNER = address(0xA11CE);
    address constant PROBER = address(0xB0B);
    address constant OUTSIDER = address(0xDEAD);

    // Real addresses from data/snapshot-2026-08-21.json.
    address constant FOUNDATION = 0x1F444c8A8D0b8e99A50e9f165806d28B01916E04;
    address constant ALIYUN = 0xB01EBd79c3fd63ff52fD47C3935119601EEe2FdB;

    function setUp() public {
        reg = new ProviderRegistry(OWNER);
        vm.prank(OWNER);
        reg.setAuthorized(PROBER, true);
    }

    function test_idsStartAtOneSoZeroMeansUnregistered() public {
        vm.prank(PROBER);
        uint16 id = reg.register(FOUNDATION, "claude-opus-5", ProviderRegistry.Mode.Standard);
        assertEq(id, 1);
        assertEq(reg.idOf(FOUNDATION, "claude-opus-5"), 1);
        assertEq(reg.idOf(FOUNDATION, "never-registered"), 0);
    }

    /// The unit of identity is (address, model) — one address serves many models.
    function test_sameAddressDifferentModelsAreDistinctProviders() public {
        vm.startPrank(PROBER);
        uint16 a = reg.register(FOUNDATION, "claude-opus-5", ProviderRegistry.Mode.Standard);
        uint16 b = reg.register(FOUNDATION, "claude-sonnet-5", ProviderRegistry.Mode.Standard);
        vm.stopPrank();

        assertTrue(a != b);
        assertEq(reg.providerCount(), 2);
        assertEq(reg.get(a).addr, reg.get(b).addr);
        assertTrue(reg.get(a).modelHash != reg.get(b).modelHash);
    }

    function test_revertsOnDuplicatePair() public {
        vm.startPrank(PROBER);
        uint16 id = reg.register(ALIYUN, "glm-5.2", ProviderRegistry.Mode.TeeTLS);
        vm.expectRevert(abi.encodeWithSelector(ProviderRegistry.AlreadyRegistered.selector, id));
        reg.register(ALIYUN, "glm-5.2", ProviderRegistry.Mode.TeeTLS);
        vm.stopPrank();
    }

    function test_revertsForUnauthorizedCaller() public {
        vm.prank(OUTSIDER);
        vm.expectRevert(Auth.NotAuthorized.selector);
        reg.register(ALIYUN, "glm-5.2", ProviderRegistry.Mode.TeeTLS);
    }

    /// Mode.Unknown is id 0, so an unset slot can never be read as a real guarantee.
    function test_revertsOnUnknownMode() public {
        vm.prank(PROBER);
        vm.expectRevert(ProviderRegistry.BadMode.selector);
        reg.register(ALIYUN, "glm-5.2", ProviderRegistry.Mode.Unknown);
    }

    function test_revertsOnEmptyModel() public {
        vm.prank(PROBER);
        vm.expectRevert(ProviderRegistry.EmptyModel.selector);
        reg.register(ALIYUN, "", ProviderRegistry.Mode.TeeTLS);
    }

    function test_getRevertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(ProviderRegistry.UnknownProvider.selector, uint16(0)));
        reg.get(0);
        vm.expectRevert(abi.encodeWithSelector(ProviderRegistry.UnknownProvider.selector, uint16(7)));
        reg.get(7);
    }

    /// The full model string never hits storage — it must be recoverable from the log.
    function test_emitsFullModelStringInEvent() public {
        vm.recordLogs();
        vm.prank(PROBER);
        reg.register(ALIYUN, "deepseek-v4-flash-0731", ProviderRegistry.Mode.TeeTLS);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        (string memory model, uint8 mode) = abi.decode(logs[0].data, (string, uint8));
        assertEq(model, "deepseek-v4-flash-0731");
        assertEq(mode, uint8(ProviderRegistry.Mode.TeeTLS));
        assertEq(logs[0].topics[3], keccak256(bytes("deepseek-v4-flash-0731")));
    }

    function test_batchRegisterMatchesSingleRegister() public {
        address[] memory addrs = new address[](2);
        string[] memory models = new string[](2);
        ProviderRegistry.Mode[] memory modes = new ProviderRegistry.Mode[](2);
        addrs[0] = ALIYUN;
        models[0] = "glm-5.2";
        modes[0] = ProviderRegistry.Mode.TeeTLS;
        addrs[1] = FOUNDATION;
        models[1] = "0GM-1.0-35B-A3B";
        modes[1] = ProviderRegistry.Mode.TeeML;

        vm.prank(PROBER);
        uint16[] memory ids = reg.registerBatch(addrs, models, modes);

        assertEq(ids[0], 1);
        assertEq(ids[1], 2);
        assertEq(reg.providerCount(), 2);
        assertEq(uint8(reg.get(2).declaredMode), uint8(ProviderRegistry.Mode.TeeML));
    }

    function test_batchRevertsOnLengthMismatch() public {
        address[] memory addrs = new address[](2);
        string[] memory models = new string[](1);
        ProviderRegistry.Mode[] memory modes = new ProviderRegistry.Mode[](2);
        vm.prank(PROBER);
        vm.expectRevert(ProviderRegistry.LengthMismatch.selector);
        reg.registerBatch(addrs, models, modes);
    }

    function testFuzz_registeredPairAlwaysResolvesBack(address addr, string calldata model) public {
        vm.assume(addr != address(0));
        vm.assume(bytes(model).length > 0);
        vm.prank(PROBER);
        uint16 id = reg.register(addr, model, ProviderRegistry.Mode.TeeML);
        assertEq(reg.idOf(addr, model), id);
        assertEq(reg.get(id).addr, addr);
        assertEq(reg.get(id).modelHash, keccak256(bytes(model)));
    }
}
