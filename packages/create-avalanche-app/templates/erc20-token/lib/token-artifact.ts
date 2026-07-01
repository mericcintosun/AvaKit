// Auto-generated from contracts/src/AvaKitToken.sol via `forge build`.
// Re-generate after editing the contract: cd contracts && forge build, then
// copy abi + bytecode.object here.

import type { Abi, Hex } from "viem";

export const abi = [
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      {
        "name": "spender",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "decimals",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "mint",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "name",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "symbol",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalSupply",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "transferFrom",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Approval",
    "inputs": [
      {
        "name": "owner",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "spender",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Transfer",
    "inputs": [
      {
        "name": "from",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "value",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const satisfies Abi;

export const bytecode = "0x6080604052348015600e575f5ffd5b5061066f8061001c5f395ff3fe608060405234801561000f575f5ffd5b506004361061009b575f3560e01c8063313ce56711610063578063313ce5671461013657806370a082311461015057806395d89b411461016f578063a9059cbb14610191578063dd62ed3e146101a4575f5ffd5b806306fdde031461009f578063095ea7b3146100e05780631249c58b1461010357806318160ddd1461010d57806323b872dd14610123575b5f5ffd5b6100ca6040518060400160405280600c81526020016b20bb30a5b4ba102a37b5b2b760a11b81525081565b6040516100d791906103f4565b60405180910390f35b6100f36100ee366004610444565b6101ce565b60405190151581526020016100d7565b61010b61023a565b005b6101155f5481565b6040519081526020016100d7565b6100f361013136600461046c565b6102b2565b61013e601281565b60405160ff90911681526020016100d7565b61011561015e3660046104a6565b60016020525f908152604090205481565b6100ca604051806040016040528060038152602001621052d560ea1b81525081565b6100f361019f366004610444565b61037e565b6101156101b23660046104c6565b600260209081525f928352604080842090915290825290205481565b335f8181526002602090815260408083206001600160a01b038716808552925280832085905551919290917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925906102289086815260200190565b60405180910390a35060015b92915050565b5f6102476012600a6105ee565b6102529060646105fc565b9050805f5f8282546102649190610613565b9091555050335f818152600160209081526040808320805486019055518481527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef910160405180910390a350565b6001600160a01b0383165f9081526002602090815260408083203384529091528120805483919083906102e6908490610626565b90915550506001600160a01b0384165f9081526001602052604081208054849290610312908490610626565b90915550506001600160a01b038084165f81815260016020526040908190208054860190555190918616907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef9061036c9086815260200190565b60405180910390a35060019392505050565b335f9081526001602052604081208054839190839061039e908490610626565b90915550506001600160a01b0383165f81815260016020526040908190208054850190555133907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef906102289086815260200190565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b80356001600160a01b038116811461043f575f5ffd5b919050565b5f5f60408385031215610455575f5ffd5b61045e83610429565b946020939093013593505050565b5f5f5f6060848603121561047e575f5ffd5b61048784610429565b925061049560208501610429565b929592945050506040919091013590565b5f602082840312156104b6575f5ffd5b6104bf82610429565b9392505050565b5f5f604083850312156104d7575f5ffd5b6104e083610429565b91506104ee60208401610429565b90509250929050565b634e487b7160e01b5f52601160045260245ffd5b6001815b60018411156105465780850481111561052a5761052a6104f7565b600184161561053857908102905b60019390931c92800261050f565b935093915050565b5f8261055c57506001610234565b8161056857505f610234565b816001811461057e5760028114610588576105a4565b6001915050610234565b60ff841115610599576105996104f7565b50506001821b610234565b5060208310610133831016604e8410600b84101617156105c7575081810a610234565b6105d35f19848461050b565b805f19048211156105e6576105e66104f7565b029392505050565b5f6104bf60ff84168361054e565b8082028115828204841417610234576102346104f7565b80820180821115610234576102346104f7565b81810381811115610234576102346104f756fea26469706673582212203ba8f5901a64d91a7beec3bdc98521ea0a7279a4ebafb699842fb133050e658e64736f6c634300081c0033" as Hex;
