// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

// Minimal Avalanche Interchain Messaging (ICM / Teleporter) interfaces, inlined
// so this contract compiles with no external dependencies. The full contracts
// live at https://github.com/ava-labs/icm-contracts.

struct TeleporterFeeInfo {
    address feeTokenAddress;
    uint256 amount;
}

struct TeleporterMessageInput {
    bytes32 destinationBlockchainID;
    address destinationAddress;
    TeleporterFeeInfo feeInfo;
    uint256 requiredGasLimit;
    address[] allowedRelayerAddresses;
    bytes message;
}

interface ITeleporterMessenger {
    function sendCrossChainMessage(TeleporterMessageInput calldata messageInput)
        external
        returns (bytes32 messageID);
}

interface ITeleporterReceiver {
    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external;
}

/// @title AvaKitMessenger — a cross-chain message board over Avalanche ICM.
/// @notice Deploy the same contract on two Avalanche L1s. Sending a string from
/// one L1 delivers it to the contract on the other L1 via Interchain Messaging;
/// the relayer carries the message and calls `receiveTeleporterMessage`.
contract AvaKitMessenger is ITeleporterReceiver {
    /// The TeleporterMessenger predeploy, at the same fixed address on every
    /// ICM-enabled Avalanche chain.
    ITeleporterMessenger public constant TELEPORTER =
        ITeleporterMessenger(0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf);

    string public lastMessage;
    bytes32 public lastSourceBlockchainID;
    address public lastOriginSender;
    uint256 public messagesReceived;

    event MessageSent(
        bytes32 indexed messageID,
        bytes32 indexed destinationBlockchainID,
        address destinationAddress,
        string message
    );
    event MessageReceived(
        bytes32 indexed sourceBlockchainID, address indexed originSender, string message
    );

    /// @notice Send `message` to an AvaKitMessenger on another Avalanche L1.
    /// @param destinationBlockchainID The destination L1's blockchain ID — a
    /// bytes32, NOT an EVM chainId. Get it from `avalanche blockchain describe`.
    /// @param destinationAddress The AvaKitMessenger address on the destination L1.
    function sendMessage(
        bytes32 destinationBlockchainID,
        address destinationAddress,
        string calldata message
    ) external returns (bytes32 messageID) {
        messageID = TELEPORTER.sendCrossChainMessage(
            TeleporterMessageInput({
                destinationBlockchainID: destinationBlockchainID,
                destinationAddress: destinationAddress,
                feeInfo: TeleporterFeeInfo({feeTokenAddress: address(0), amount: 0}),
                requiredGasLimit: 250000,
                allowedRelayerAddresses: new address[](0),
                message: abi.encode(message)
            })
        );
        emit MessageSent(messageID, destinationBlockchainID, destinationAddress, message);
    }

    /// @notice Called by the local TeleporterMessenger when a message arrives.
    function receiveTeleporterMessage(
        bytes32 sourceBlockchainID,
        address originSenderAddress,
        bytes calldata message
    ) external {
        require(msg.sender == address(TELEPORTER), "AvaKitMessenger: caller is not the Teleporter");
        string memory decoded = abi.decode(message, (string));
        lastMessage = decoded;
        lastSourceBlockchainID = sourceBlockchainID;
        lastOriginSender = originSenderAddress;
        messagesReceived += 1;
        emit MessageReceived(sourceBlockchainID, originSenderAddress, decoded);
    }
}
