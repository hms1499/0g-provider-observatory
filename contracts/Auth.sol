// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * Minimal owner + allowlist.
 *
 * Deliberately small. In Wave 5 the network becomes permissionless with staked
 * probers; when that happens only `onlyAuthorized` is replaced. Nothing on the read
 * path depends on this contract, so opening the gate later needs no data migration.
 */
abstract contract Auth {
    address public owner;
    mapping(address => bool) public authorized;

    event OwnerTransferred(address indexed from, address indexed to);
    event AuthorizedSet(address indexed account, bool allowed);

    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerTransferred(address(0), owner_);
    }

    modifier onlyOwner() {
        _requireOwner();
        _;
    }

    modifier onlyAuthorized() {
        _requireAuthorized();
        _;
    }

    /// Kept out of the modifier body so the check is not inlined at every call site.
    function _requireOwner() internal view {
        if (msg.sender != owner) revert NotOwner();
    }

    function _requireAuthorized() internal view {
        if (!authorized[msg.sender]) revert NotAuthorized();
    }

    function setAuthorized(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        authorized[account] = allowed;
        emit AuthorizedSet(account, allowed);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerTransferred(owner, next);
        owner = next;
    }
}
