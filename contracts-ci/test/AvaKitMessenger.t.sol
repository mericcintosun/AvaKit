// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {TestBase} from "./TestBase.sol";
import {
    AvaKitMessenger,
    TeleporterMessageInput
} from "../src/AvaKitMessenger.sol";

/// @dev Stand-in for the TeleporterMessenger predeploy. The test etches its
/// runtime code at the canonical predeploy address, so the messenger's calls
/// to TELEPORTER land here and the inputs can be asserted.
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

/// @dev A message of exactly `length` bytes, none of them zero — the costliest
/// content to receive, since every 32-byte word of it fills a storage slot.
function messageOfLength(uint256 length) pure returns (string memory) {
    bytes memory raw = new bytes(length);
    for (uint256 i = 0; i < length; i++) raw[i] = "a";
    return string(raw);
}

contract AvaKitMessengerTest is TestBase {
    /// The canonical ICM predeploy address (what the templates deploy with).
    address internal constant TELEPORTER_ADDR =
        0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf;

    bytes32 internal constant DEST_CHAIN = bytes32(uint256(0xC0FFEE));
    bytes32 internal constant SRC_CHAIN = bytes32(uint256(0xBEEF));
    address internal constant PEER = address(0x9EE2);
    address internal constant STRANGER = address(0xBAD);

    AvaKitMessenger internal messenger;
    MockTeleporter internal teleporter;
    /// A second messenger standing in for the other chain's: it already trusts
    /// `messenger` as its remote on SRC_CHAIN (see the delivery budget tests).
    AvaKitMessenger internal destination;

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
    event TrustedRemoteSet(bytes32 indexed sourceBlockchainID, address remote);

    function setUp() public {
        // Put a recording mock at the predeploy address, then deploy against it
        // the same way the template does (constructor takes the teleporter).
        vm.etch(TELEPORTER_ADDR, type(MockTeleporter).runtimeCode);
        teleporter = MockTeleporter(TELEPORTER_ADDR);
        messenger = new AvaKitMessenger(TELEPORTER_ADDR);

        destination = new AvaKitMessenger(TELEPORTER_ADDR);
        destination.setTrustedRemote(SRC_CHAIN, address(messenger));
    }

    // ---- constructor ----

    function test_ConstructorWiresTeleporterAndOwner() public view {
        assertEq(
            address(messenger.TELEPORTER()),
            TELEPORTER_ADDR,
            "teleporter address"
        );
        assertEq(messenger.owner(), address(this), "owner is deployer");
    }

    // ---- setTrustedRemote ----

    function test_SetTrustedRemoteStoresPeer() public {
        vm.expectEmit(true, false, false, true);
        emit TrustedRemoteSet(SRC_CHAIN, PEER);
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

        assertEq(messenger.trustedRemote(SRC_CHAIN), PEER, "trusted remote");
    }

    function test_SetTrustedRemoteRevertsForNonOwner() public {
        vm.expectRevert(bytes("AvaKitMessenger: caller is not the owner"));
        vm.prank(STRANGER);
        messenger.setTrustedRemote(SRC_CHAIN, PEER);
    }

    function test_SetTrustedRemoteCanReplacePeer() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);
        messenger.setTrustedRemote(SRC_CHAIN, STRANGER);
        assertEq(messenger.trustedRemote(SRC_CHAIN), STRANGER, "replaced");
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
        assertEq(teleporter.lastRequiredGasLimit(), 350000, "gas limit");
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

    // ---- message length cap ----

    function test_MaxMessageLengthIs256Bytes() public view {
        assertEq(messenger.MAX_MESSAGE_LENGTH(), 256, "MAX_MESSAGE_LENGTH");
    }

    function test_SendMessageAcceptsTheLongestMessage() public {
        string memory text = messageOfLength(256);
        messenger.sendMessage(DEST_CHAIN, PEER, text);

        assertEq(teleporter.calls(), 1, "one teleporter call");
        assertEq(
            keccak256(teleporter.lastPayload()),
            keccak256(abi.encode(text)),
            "payload intact"
        );
    }

    function test_SendMessageRevertsOneByteOverTheLimit() public {
        string memory text = messageOfLength(257);

        vm.expectRevert(bytes("AvaKitMessenger: message too long"));
        messenger.sendMessage(DEST_CHAIN, PEER, text);

        assertEq(teleporter.calls(), 0, "nothing reached the Teleporter");
    }

    function test_MessageLengthIsCountedInBytesNotCharacters() public {
        // "\u00e9" is one character and two UTF-8 bytes: 128 of them are
        // exactly the limit, 129 are over it.
        string memory text = "";
        for (uint256 i = 0; i < 128; i++) text = string.concat(text, "\u00e9");
        assertEq(bytes(text).length, 256, "128 characters, 256 bytes");
        messenger.sendMessage(DEST_CHAIN, PEER, text);

        text = string.concat(text, "\u00e9");
        vm.expectRevert(bytes("AvaKitMessenger: message too long"));
        messenger.sendMessage(DEST_CHAIN, PEER, text);
    }

    // ---- delivery budget ----
    //
    // The destination chain's Teleporter hands `receiveTeleporterMessage`
    // exactly the gas `sendMessage` asked for. If that runs out, the send has
    // already succeeded on the source chain and nothing arrives: the Teleporter
    // keeps the message for a manual retry instead of delivering it. So the
    // longest message `sendMessage` accepts has to fit the gas it requests in
    // the costliest case — a first delivery, when every storage slot the
    // receiver writes is still empty.
    //
    // `destination` was linked in setUp, not in these tests: forge runs each
    // test as its own transaction, so its storage is cold here exactly as it
    // is when a relayer delivers.

    function test_LongestMessageIsDeliveredWithTheGasSendMessageRequests() public {
        string memory text = messageOfLength(messenger.MAX_MESSAGE_LENGTH());
        messenger.sendMessage(DEST_CHAIN, address(destination), text);

        _deliver(teleporter.lastRequiredGasLimit());

        assertEq(destination.lastMessage(), text, "delivered intact");
        assertEq(destination.messagesReceived(), 1, "delivered once");
    }

    function test_DeliveryBudgetLeavesHeadroom() public {
        // Keep a tenth of the requested gas in reserve. The EVM holds back 1/64
        // of a caller's remaining gas on every call (EIP-150), so a delivery
        // made with only just enough gas hands the receiver slightly less than
        // was asked for, and a contract rebuilt with other compiler settings
        // may burn a little more. If this fails, raise the gas `sendMessage`
        // requests (or lower MAX_MESSAGE_LENGTH).
        string memory text = messageOfLength(messenger.MAX_MESSAGE_LENGTH());
        messenger.sendMessage(DEST_CHAIN, address(destination), text);

        uint256 requested = teleporter.lastRequiredGasLimit();
        _deliver(requested - requested / 10);

        assertEq(destination.lastMessage(), text, "delivered intact");
    }

    /// Deliver what `messenger` last sent to `destination`, forwarding exactly
    /// `gasLimit` gas the way the Teleporter does.
    function _deliver(uint256 gasLimit) private {
        bytes memory payload = teleporter.lastPayload();
        vm.prank(TELEPORTER_ADDR);
        destination.receiveTeleporterMessage{gas: gasLimit}(
            SRC_CHAIN,
            address(messenger),
            payload
        );
    }

    // ---- receiveTeleporterMessage ----

    function test_ReceiveRevertsWhenCallerIsNotTeleporter() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

        vm.expectRevert(bytes("AvaKitMessenger: caller is not the Teleporter"));
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("spoof"));
    }

    function test_ReceiveRevertsWhenRemoteNotRegistered() public {
        // No setTrustedRemote call: every source must be rejected.
        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("hi"));
    }

    function test_ReceiveRevertsForUntrustedSender() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

        // Right chain, wrong origin contract — the Teleporter delivers from
        // ANY contract, so this is the spoof the allowlist exists to stop.
        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(
            SRC_CHAIN,
            STRANGER,
            abi.encode("spoof")
        );
    }

    function test_ReceiveRevertsForWrongSourceChain() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

        // Trusted contract address, but arriving from an unregistered chain.
        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(
            DEST_CHAIN,
            PEER,
            abi.encode("spoof")
        );
    }

    function test_ReceiveRevertsForZeroSenderFromUnregisteredChain() public {
        // An unregistered chain reads as address(0) in the mapping, so an
        // origin sender of address(0) would "match" it. The origin sender is
        // whatever the source chain's Teleporter reports, and anyone can run
        // an L1 — unregistered must mean rejected, with no sender excepted.
        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(
            SRC_CHAIN,
            address(0),
            abi.encode("spoof")
        );
    }

    function test_ReceiveRevertsAfterRemoteIsCleared() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);
        // Registering address(0) is how the owner stops trusting a chain.
        messenger.setTrustedRemote(SRC_CHAIN, address(0));

        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("late"));

        vm.expectRevert(bytes("AvaKitMessenger: untrusted remote"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(
            SRC_CHAIN,
            address(0),
            abi.encode("spoof")
        );

        assertEq(messenger.messagesReceived(), 0, "nothing was stored");
    }

    function test_ReceiveStoresMessageFromTrustedRemote() public {
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

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
        messenger.setTrustedRemote(SRC_CHAIN, PEER);

        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("one"));
        vm.prank(TELEPORTER_ADDR);
        messenger.receiveTeleporterMessage(SRC_CHAIN, PEER, abi.encode("two"));

        assertEq(messenger.messagesReceived(), 2, "messagesReceived");
        assertEq(messenger.lastMessage(), "two", "last delivery wins");
    }
}
