// biome-ignore-all format: generated code, kept exactly as the compiler emits it
// Generated from contracts/src/AvaKitNFT.sol. Do not edit the abi or bytecode
// by hand: after changing the contract, regenerate them from the repo root with
//   cd contracts-ci && node scripts/check-artifacts.mjs --write
// CI fails if this file and that source drift apart. Bundling them lets the
// app deploy from the browser with no Foundry required at runtime.

import type { Abi, Hex } from "viem";

export const abi = [
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
    "name": "mint",
    "inputs": [],
    "outputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
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
    "name": "ownerOf",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [
      {
        "name": "interfaceId",
        "type": "bytes4",
        "internalType": "bytes4"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "pure"
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
    "name": "tokenURI",
    "inputs": [
      {
        "name": "tokenId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "pure"
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
        "name": "tokenId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  }
] as const satisfies Abi;

export const bytecode = "0x6080604052348015600e575f5ffd5b5061056d8061001c5f395ff3fe608060405234801561000f575f5ffd5b5060043610610085575f3560e01c80636352211e116100585780636352211e1461010557806370a082311461014557806395d89b4114610164578063c87b56dd14610189575f5ffd5b806301ffc9a71461008957806306fdde03146100b15780631249c58b146100e757806318160ddd146100fd575b5f5ffd5b61009c610097366004610383565b61019c565b60405190151581526020015b60405180910390f35b6100da6040518060400160405280600a815260200169105d9852da5d0813919560b21b81525081565b6040516100a891906103b1565b6100ef6101d2565b6040519081526020016100a8565b6100ef5f5481565b61012d6101133660046103e6565b60016020525f90815260409020546001600160a01b031681565b6040516001600160a01b0390911681526020016100a8565b6100ef6101533660046103fd565b60026020525f908152604090205481565b6100da6040518060400160405280600681526020016510559052d25560d21b81525081565b6100da6101973660046103e6565b61024d565b5f6380ac58cd60e01b6001600160e01b0319831614806101cc57506301ffc9a760e01b6001600160e01b03198316145b92915050565b5f5f5f81546101e090610437565b91829055505f81815260016020818152604080842080546001600160a01b0319163390811790915580855260029092528084208054909301909255905192935083929091907fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef908290a490565b60606102588261027e565b604051602001610268919061044f565b6040516020818303038152906040529050919050565b6060815f036102a45750506040805180820190915260018152600360fc1b602082015290565b815f5b81156102cd57806102b781610437565b91506102c69050600a836104c3565b91506102a7565b5f8167ffffffffffffffff8111156102e7576102e76104d6565b6040519080825280601f01601f191660200182016040528015610311576020820181803683370190505b5090505b841561037b576103266001836104ea565b9150610333600a866104fd565b61033e906030610510565b60f81b81838151811061035357610353610523565b60200101906001600160f81b03191690815f1a905350610374600a866104c3565b9450610315565b949350505050565b5f60208284031215610393575f5ffd5b81356001600160e01b0319811681146103aa575f5ffd5b9392505050565b602081525f82518060208401528060208501604085015e5f604082850101526040601f19601f83011684010191505092915050565b5f602082840312156103f6575f5ffd5b5035919050565b5f6020828403121561040d575f5ffd5b81356001600160a01b03811681146103aa575f5ffd5b634e487b7160e01b5f52601160045260245ffd5b5f6001820161044857610448610423565b5060010190565b7f646174613a6170706c69636174696f6e2f6a736f6e3b757466382c7b226e616d81526d65223a224176614b69742025323360901b60208201525f82518060208501602e85015e61227d60f01b602e939091019283015250603001919050565b634e487b7160e01b5f52601260045260245ffd5b5f826104d1576104d16104af565b500490565b634e487b7160e01b5f52604160045260245ffd5b818103818111156101cc576101cc610423565b5f8261050b5761050b6104af565b500690565b808201808211156101cc576101cc610423565b634e487b7160e01b5f52603260045260245ffdfea2646970667358221220938d74a4f2f969ca34cacb0db82762c7c29d9f8c305a5c3182ab3d3be6dc73b664736f6c634300081c0033" as Hex;
