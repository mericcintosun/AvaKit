// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title AvaKitToken
/// @notice A minimal, self-contained ERC-20 with a public demo faucet (`mint`).
///         No external deps, so it compiles out of the box with `forge build`.
contract AvaKitToken {
    string public constant name = "AvaKit Token";
    string public constant symbol = "AKT";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /// @notice Mint 100 AKT to the caller (demo faucet).
    function mint() external {
        uint256 amount = 100 * 10 ** decimals;
        totalSupply += amount;
        unchecked {
            balanceOf[msg.sender] += amount;
        }
        emit Transfer(address(0), msg.sender, amount);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        unchecked {
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
