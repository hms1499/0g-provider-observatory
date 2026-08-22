// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {ProviderRegistry} from "../contracts/ProviderRegistry.sol";
import {MeasurementRegistry} from "../contracts/MeasurementRegistry.sol";

/**
 * Deploy both contracts and authorise the deployer as the first prober.
 *
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast
 *
 * EPOCH_SECONDS defaults to one hour. It is immutable after deployment, so choosing it
 * is choosing how fast history accumulates — and judges open the explorer looking for
 * real activity, which takes wall-clock time to exist.
 */
contract Deploy is Script {
    function run() external returns (ProviderRegistry reg, MeasurementRegistry mr) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        uint32 epochSeconds = uint32(vm.envOr("EPOCH_SECONDS", uint256(3600)));

        vm.startBroadcast(pk);

        reg = new ProviderRegistry(deployer);
        mr = new MeasurementRegistry(deployer, reg, epochSeconds);

        reg.setAuthorized(deployer, true);
        mr.setAuthorized(deployer, true);

        vm.stopBroadcast();

        console.log("chain id            ", block.chainid);
        console.log("deployer / prober   ", deployer);
        console.log("ProviderRegistry    ", address(reg));
        console.log("MeasurementRegistry ", address(mr));
        console.log("epoch seconds       ", epochSeconds);
    }
}
