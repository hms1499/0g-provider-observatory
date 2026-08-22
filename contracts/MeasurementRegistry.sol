// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Auth} from "./Auth.sol";
import {ProviderRegistry} from "./ProviderRegistry.sol";

/**
 * The measurement ledger. One epoch of results, written once, readable by anyone.
 *
 * Four properties this contract exists to provide, in order of importance:
 *
 * 1. WRITE ONCE. There is no update and no delete, not even for the owner. A record
 *    that could be revised afterwards would be worth nothing as history, which is the
 *    entire point of putting it on chain rather than in a database.
 *
 * 2. CHEAP. Only a summary lives here; the raw transcript goes to 0G Storage and this
 *    contract keeps its merkle root. Every measurement is packed into exactly one
 *    storage slot, and a whole epoch is written in a single transaction.
 *
 * 3. SELF-DESCRIBING. `storageRoot` points at the evidence the summary was derived
 *    from, so the verification CLI can refetch the transcript, recompute p50/p95 and
 *    divergence, and check them against what is written here. A summary with no path
 *    back to its evidence would just be an opinion with gas attached.
 *
 * 4. OPEN FOR MORE PROBERS. Every record is keyed by (epoch, prober) from the start,
 *    even though only one prober is authorised today. Wave 5 replaces the allowlist
 *    with staking and touches nothing on the read path.
 *
 * Epochs are derived from time, not assigned by a counter: `epoch = timestamp / EPOCH_DURATION`.
 * That means several probers independently land in the same epoch with no coordination,
 * and anyone can compute which epoch any timestamp belongs to as a pure function.
 */
contract MeasurementRegistry is Auth {
    /// Exactly one storage slot: 2 + 4 + 4 + 2 + 2 + 2 + 1 = 17 bytes.
    struct Measurement {
        uint16 providerId; // into ProviderRegistry
        uint32 p50Ms; // self-measured, never the Router's own figure
        uint32 p95Ms;
        uint16 errorRateBps; // basis points, 10000 = 100%
        uint16 divergenceBps; // distance from the calibration reference, already net of noise floor
        uint16 calls; // samples behind the numbers above
        uint8 observedMode; // recorded per epoch: a provider's mode can change
    }

    /// Slot 1: 20 + 8 + 2 = 30 bytes. Slot 2: storageRoot.
    struct EpochHeader {
        address prober;
        uint64 writtenAt;
        uint16 count;
        bytes32 storageRoot; // 0G Storage merkle root of the raw transcript
    }

    ProviderRegistry public immutable REGISTRY;
    /// Seconds per epoch. Immutable so `epochOf` stays a pure function of time.
    uint32 public immutable EPOCH_DURATION;

    mapping(bytes32 => EpochHeader) private _headers;
    mapping(bytes32 => Measurement[]) private _measurements;
    /// Lets a reader enumerate a prober's history without scanning logs.
    mapping(address => uint32[]) private _epochsByProber;

    event EpochWritten(
        uint32 indexed epoch, address indexed prober, bytes32 storageRoot, uint16 count
    );

    error AlreadyWritten(uint32 epoch, address prober);
    error EmptyEpoch();
    error MissingStorageRoot();
    error UnknownProvider(uint16 id);
    error DuplicateProvider(uint16 id);
    error EpochNotWritten(uint32 epoch, address prober);
    error BadEpochDuration();

    constructor(address owner_, ProviderRegistry registry_, uint32 epochDuration_) Auth(owner_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        if (epochDuration_ == 0) revert BadEpochDuration();
        REGISTRY = registry_;
        EPOCH_DURATION = epochDuration_;
    }

    /// Pure function of time — a verifier can compute this without touching the chain.
    function epochOf(uint64 timestamp) public view returns (uint32) {
        return uint32(timestamp / EPOCH_DURATION);
    }

    function currentEpoch() public view returns (uint32) {
        return epochOf(uint64(block.timestamp));
    }

    function slotOf(uint32 epoch, address prober) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(epoch, prober));
    }

    /**
     * Write one epoch. Reverts if this prober already wrote this epoch.
     *
     * Services that could not be measured are simply absent — no zero-filled record.
     * A zero would read as "instant", and a reader deriving "not measured" from
     * registry-minus-epoch gets the truth instead. Stating what we do not know is
     * cheaper than pretending we do.
     */
    function writeEpoch(bytes32 storageRoot, Measurement[] calldata items)
        external
        onlyAuthorized
    {
        if (items.length == 0) revert EmptyEpoch();
        if (storageRoot == bytes32(0)) revert MissingStorageRoot();

        uint32 epoch = currentEpoch();
        bytes32 slot = slotOf(epoch, msg.sender);
        if (_headers[slot].writtenAt != 0) revert AlreadyWritten(epoch, msg.sender);

        uint16 maxId = REGISTRY.providerCount();
        Measurement[] storage dst = _measurements[slot];

        // Bitmap over provider ids, so a duplicate inside one epoch cannot slip through.
        uint256 words = (uint256(maxId) >> 8) + 1;
        uint256[] memory seen = new uint256[](words);

        for (uint256 i = 0; i < items.length; ++i) {
            uint16 id = items[i].providerId;
            if (id == 0 || id > maxId) revert UnknownProvider(id);

            uint256 w = uint256(id) >> 8;
            uint256 bit = 1 << (id & 0xff);
            if (seen[w] & bit != 0) revert DuplicateProvider(id);
            seen[w] |= bit;

            dst.push(items[i]);
        }

        _headers[slot] = EpochHeader({
            prober: msg.sender,
            writtenAt: uint64(block.timestamp),
            count: uint16(items.length),
            storageRoot: storageRoot
        });
        _epochsByProber[msg.sender].push(epoch);

        emit EpochWritten(epoch, msg.sender, storageRoot, uint16(items.length));
    }

    function getHeader(uint32 epoch, address prober) external view returns (EpochHeader memory) {
        EpochHeader memory h = _headers[slotOf(epoch, prober)];
        if (h.writtenAt == 0) revert EpochNotWritten(epoch, prober);
        return h;
    }

    /// Returns the whole epoch in one call. Filtering by provider is the reader's job —
    /// a per-id index would cost a second storage slot per measurement to save nothing.
    function getMeasurements(uint32 epoch, address prober)
        external
        view
        returns (Measurement[] memory)
    {
        return _measurements[slotOf(epoch, prober)];
    }

    function epochsOf(address prober) external view returns (uint32[] memory) {
        return _epochsByProber[prober];
    }

    function epochCountOf(address prober) external view returns (uint256) {
        return _epochsByProber[prober].length;
    }

    function isWritten(uint32 epoch, address prober) external view returns (bool) {
        return _headers[slotOf(epoch, prober)].writtenAt != 0;
    }
}
