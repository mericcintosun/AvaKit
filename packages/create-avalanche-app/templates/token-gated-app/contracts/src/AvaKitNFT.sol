// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AvaKitNFT
/// @notice A minimal, self-contained ERC-721 mint demo (no external deps so it
///         compiles out of the box with `forge build`). Public mint, on-chain
///         metadata. Not a full ERC-721 (no transfer/approve) — it's a starting
///         point you can extend.
contract AvaKitNFT {
    string public constant name = "AvaKit NFT";
    string public constant symbol = "AVAKIT";

    uint256 public totalSupply;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    /// @notice Mint the next token to the caller.
    function mint() external returns (uint256 tokenId) {
        tokenId = ++totalSupply;
        ownerOf[tokenId] = msg.sender;
        unchecked {
            balanceOf[msg.sender] += 1;
        }
        emit Transfer(address(0), msg.sender, tokenId);
    }

    /// @notice Minimal on-chain metadata.
    function tokenURI(uint256 tokenId) external pure returns (string memory) {
        return string.concat(
            'data:application/json;utf8,{"name":"AvaKit #', _toString(tokenId), '"}'
        );
    }

    /// @notice ERC-165: advertises ERC-721 + ERC-165 interface ids.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x01ffc9a7;
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
