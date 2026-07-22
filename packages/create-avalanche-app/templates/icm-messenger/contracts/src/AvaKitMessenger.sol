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
/// @notice Deploy the same contract on two Avalanche L1s, then link them:
/// each side registers the other as its trusted remote. Sending a string from
/// one L1 delivers it to the contract on the other L1 via Interchain Messaging;
/// the relayer carries the message and calls `receiveTeleporterMessage`.
///
/// Two checks make receiving safe, and both are required:
/// 1. `msg.sender` must be the Teleporter — otherwise anyone can call this
///    function directly and fake a delivery.
/// 2. `(sourceBlockchainID, originSenderAddress)` must match the registered
///    trusted remote — the Teleporter delivers messages from ANY contract on
///    ANY ICM-enabled chain, so without this check any stranger contract
///    could write to this message board through the real Teleporter.
contract AvaKitMessenger is ITeleporterReceiver {
    /// The TeleporterMessenger this contract trusts. On every ICM-enabled
    /// Avalanche chain the canonical predeploy lives at
    /// 0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf, but it is a constructor
    /// parameter (immutable, not hardcoded) because a chain can run a
    /// different Teleporter version — read the real address from
    /// `avalanche blockchain describe` rather than assuming.
    ITeleporterMessenger public immutable TELEPORTER;

    /// The deployer. Only the owner can register trusted remotes.
    address public immutable owner;

    /// The AvaKitMessenger this contract accepts messages from, per source
    /// chain: blockchain ID (bytes32, NOT the EVM chainId) => contract address.
    /// Unset (address(0)) means messages from that chain are rejected.
    mapping(bytes32 => address) public trustedRemote;

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
    event TrustedRemoteSet(bytes32 indexed sourceBlockchainID, address remote);

    /// @param teleporter The chain's TeleporterMessenger (see the note on
    /// `TELEPORTER` above — usually the canonical predeploy address).
    constructor(address teleporter) {
        TELEPORTER = ITeleporterMessenger(teleporter);
        owner = msg.sender;
    }

    /// @notice Register (or replace) the AvaKitMessenger this contract accepts
    /// messages from on `sourceBlockchainID`. Call it on BOTH sides after
    /// deploying: each messenger trusts the other one.
    function setTrustedRemote(bytes32 sourceBlockchainID, address remote) external {
        require(msg.sender == owner, "AvaKitMessenger: caller is not the owner");
        trustedRemote[sourceBlockchainID] = remote;
        emit TrustedRemoteSet(sourceBlockchainID, remote);
    }

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
        require(
            trustedRemote[sourceBlockchainID] == originSenderAddress,
            "AvaKitMessenger: untrusted remote"
        );
        string memory decoded = abi.decode(message, (string));
        lastMessage = decoded;
        lastSourceBlockchainID = sourceBlockchainID;
        lastOriginSender = originSenderAddress;
        messagesReceived += 1;
        emit MessageReceived(sourceBlockchainID, originSenderAddress, decoded);
    }
}
