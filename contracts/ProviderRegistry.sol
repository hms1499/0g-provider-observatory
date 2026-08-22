// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Auth} from "./Auth.sol";

/**
 * Stable identity for the things being measured.
 *
 * A provider is NOT an address. One address serves many models — on 2026-08-21 a
 * single 0G Foundation address served nine — and each model behaves differently.
 * So the unit of identity is the pair (address, model), and each pair gets a uint16
 * id that measurements refer to. Referring by id keeps a measurement inside one
 * storage slot; referring by address plus model string would not.
 *
 * The full model string is never stored. Its keccak hash goes to storage and the
 * string is emitted in ProviderRegistered. Reading a log is still reading the chain,
 * so a verifier never has to trust our server, and it costs a fraction of an SSTORE.
 */
contract ProviderRegistry is Auth {
    /// Guarantee mode. Unknown is id 0 so an unset slot is never mistaken for a real mode.
    enum Mode {
        Unknown,
        TeeML,
        TeeTLS,
        Standard
    }

    struct Provider {
        address addr; // 20 bytes
        uint8 declaredMode; //  1  — what the network claims about itself
        uint32 registeredAt; //  4  — block timestamp, for "since when do we know this"
        bytes32 modelHash; // second slot
    }

    uint16 public providerCount;
    mapping(uint16 => Provider) private _providers;
    /// keccak(addr, modelHash) -> id. Guards against registering the same pair twice.
    mapping(bytes32 => uint16) private _idByKey;

    event ProviderRegistered(
        uint16 indexed id,
        address indexed addr,
        bytes32 indexed modelHash,
        string model,
        uint8 declaredMode
    );

    error AlreadyRegistered(uint16 id);
    error UnknownProvider(uint16 id);
    error EmptyModel();
    error BadMode();
    error LengthMismatch();

    constructor(address owner_) Auth(owner_) {}

    function keyOf(address addr, bytes32 modelHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(addr, modelHash));
    }

    /// Id of an already-registered pair, or 0 if it is not registered.
    function idOf(address addr, string calldata model) external view returns (uint16) {
        return _idByKey[keyOf(addr, keccak256(bytes(model)))];
    }

    function get(uint16 id) external view returns (Provider memory) {
        if (id == 0 || id > providerCount) revert UnknownProvider(id);
        return _providers[id];
    }

    /// Ids start at 1, so 0 stays available as "not registered".
    function register(address addr, string calldata model, Mode declaredMode)
        public
        onlyAuthorized
        returns (uint16 id)
    {
        if (bytes(model).length == 0) revert EmptyModel();
        if (declaredMode == Mode.Unknown) revert BadMode();
        if (addr == address(0)) revert ZeroAddress();

        bytes32 modelHash = keccak256(bytes(model));
        bytes32 key = keyOf(addr, modelHash);

        uint16 existing = _idByKey[key];
        if (existing != 0) revert AlreadyRegistered(existing);

        id = ++providerCount;
        _providers[id] = Provider({
            addr: addr,
            declaredMode: uint8(declaredMode),
            registeredAt: uint32(block.timestamp),
            modelHash: modelHash
        });
        _idByKey[key] = id;

        emit ProviderRegistered(id, addr, modelHash, model, uint8(declaredMode));
    }

    function registerBatch(
        address[] calldata addrs,
        string[] calldata models,
        Mode[] calldata declaredModes
    ) external onlyAuthorized returns (uint16[] memory ids) {
        uint256 n = addrs.length;
        if (models.length != n || declaredModes.length != n) revert LengthMismatch();

        ids = new uint16[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = register(addrs[i], models[i], declaredModes[i]);
        }
    }
}
