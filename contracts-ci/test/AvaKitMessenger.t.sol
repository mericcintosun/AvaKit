// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TestBase} from "./TestBase.sol";
import {
    AvaKitMessenger,
    TeleporterMessageInput
} from "../src/AvaKitMessenger.sol";

/// @dev Stand-in for the TeleporterMessenger predeploy. The test etches its
/// runtime code at the fixed predeploy address, so the messenger's calls to
/// TELEPORTER land here and the inputs can be asserted.
contract MockTeleporter {
    bytes32 public lastDestinationBlockchainID;
    address public lastDestinationAddress;
    uint256 public lastRequiredGasLimit;
    bytes public lastPayload;
    uint256 public calls;

    function sendCrossChainMessage(
        TeleporterMessageInput calldata input
    ) external returns (bytes32) {
        lastDestinationBlockchainID = input.destinationBlockchainID;
        lastDestinationAddress = input.destinationAddress;
        lastRequiredGasLimit = input.requiredGasLimit;
        lastPayload = input.message;
        calls += 1;
        return keccak256(abi.encode(address(this), calls));
    }
}

contract AvaKitMessengerTest is TestBase {
    /// Must match AvaKitMessenger.TELEPORTER (the ICM predeploy address).
    address internal constant TELEPORTER_ADDR =
        0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf;

    bytes32 internal constant DEST_CHAIN = bytes32(uint256(0xC0FFEE));
    bytes32 internal constant SRC_CHAIN = bytes32(uint256(0xBEEF));
    address internal constant PEER = address(0x9EE2);

    AvaKitMessenger internal messenger;
    MockTeleporter internal teleporter;

    event MessageSent(
        bytes32 indexed messageID,
        bytes32 indexed destinationBlockchainID,
        address destinationAddress,
        string message
    );
    event MessageReceived(
        bytes32 indexed sourceBlockchainID,
        address indexed originSender,
        string message
    );

    function setUp() public {
        messenger = new AvaKitMessenger();
        // Put a recording mock at the predeploy address the contract hardcodes.
        vm.etch(TELEPORTER_ADDR, type(MockTeleporter).runtimeCode);
        teleporter = MockTeleporter(TELEPORTER_ADDR);
    }

    // ---- sendMessage ----

    function test_SendMessageCallsTeleporter() public {
        messenger.sendMessage(DEST_CHAIN, PEER, "hello from chain one");

        assertEq(teleporter.calls(), 1, "one teleporter call");
        assertEq(
            teleporter.lastDestinationBlockchainID(),
            DEST_CHAIN,
            "destination chain"
        );
        assertEq(teleporter.lastDestinationAddress(), PEER, "destination address");
        assertEq(teleporter.lastRequiredGasLimit(), 250000, "gas limit");
        // The payload must be the abi-encoded string the receiver decodes.
        assertEq(
            keccak256(teleporter.lastPayload()),
            keccak256(abi.encode("hello from chain one")),
            "payload encoding"
        );
    }

    function test_SendMessageEmitsEvent() public {
        vm.expectEmit(false, true, false, true);
        emit MessageSent(bytes32(0), DEST_CHAIN, PEER, "ping");
        messenger.sendMessage(DEST_CHAIN, PEER, "ping");
    }

    // ---- receiveTeleporterMessage ----

    function test_ReceiveRevertsWhenCallerIsNotTeleporter() public {
        vm.expectRevert(bytes("AvaKitMessenger: caller is not the Teleporter"));
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("spoof"));
    }

    function test_ReceiveStoresMessageFromTeleporter() public {
        vm.expectEmit(true, true, false, true);
        emit MessageReceived(SRC_CHAIN, PEER, "hello from chain two");
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(
            SRC_CHAIN,
            PEER,
            abi.encode("hello from chain two")
        );

        assertEq(messenger.lastMessage(), "hello from chain two", "lastMessage");
        assertEq(
            messenger.lastSourceBlockchainID(),
            SRC_CHAIN,
            "lastSourceBlockchainID"
        );
        assertEq(messenger.lastOriginSender(), PEER, "lastOriginSender");
        assertEq(messenger.messagesReceived(), 1, "messagesReceived");
    }

    function test_ReceiveCountsEveryDelivery() public {
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("one"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("two"));

        assertEq(messenger.messagesReceived(), 2, "messagesReceived");
        assertEq(messenger.lastMessage(), "two", "last delivery wins");
    }
}
