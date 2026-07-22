// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TestBase} from "./TestBase.sol";
import {AvaKitNFT, IERC721Receiver} from "../src/AvaKitNFT.sol";

/// @dev Accepts safe transfers and records the last call.
contract GoodReceiver is IERC721Receiver {
    address public lastOperator;
    address public lastFrom;
    uint256 public lastTokenId;

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata
    ) external returns (bytes4) {
        lastOperator = operator;
        lastFrom = from;
        lastTokenId = tokenId;
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @dev Implements the hook but returns the wrong selector — must be rejected.
contract BadReceiver is IERC721Receiver {
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

contract AvaKitNFTTest is TestBase {
    AvaKitNFT internal nft;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant CAROL = address(0xCA201);

    event Transfer(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
    );
    event Approval(
        address indexed owner,
        address indexed approved,
        uint256 indexed tokenId
    );
    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    function setUp() public {
        nft = new AvaKitNFT();
    }

    // ---- mint ----

    function test_MintAssignsSequentialIds() public {
        vm.prank(ALICE);
        uint256 first = nft.mint();
        vm.prank(BOB);
        uint256 second = nft.mint();

        assertEq(first, 1, "first tokenId");
        assertEq(second, 2, "second tokenId");
        assertEq(nft.totalSupply(), 2, "totalSupply");
        assertEq(nft.ownerOf(1), ALICE, "owner of #1");
        assertEq(nft.ownerOf(2), BOB, "owner of #2");
    }

    function test_MintTracksBalances() public {
        vm.prank(ALICE);
        nft.mint();
        vm.prank(ALICE);
        nft.mint();
        vm.prank(BOB);
        nft.mint();

        assertEq(nft.balanceOf(ALICE), 2, "alice balance");
        assertEq(nft.balanceOf(BOB), 1, "bob balance");
    }

    function test_MintEmitsTransferFromZero() public {
        vm.expectEmit(true, true, true, false);
        emit Transfer(address(0), ALICE, 1);
        vm.prank(ALICE);
        nft.mint();
    }

    // ---- ERC-165 ----

    function test_SupportsRequiredInterfaces() public view {
        assertTrue(nft.supportsInterface(0x01ffc9a7), "ERC-165");
        assertTrue(nft.supportsInterface(0x80ac58cd), "ERC-721");
        assertTrue(nft.supportsInterface(0x5b5e139f), "ERC-721 Metadata");
        assertTrue(!nft.supportsInterface(0xffffffff), "0xffffffff must be false");
        assertTrue(!nft.supportsInterface(0x780e9d63), "Enumerable not claimed");
    }

    function test_OwnerOfRevertsForNonexistentToken() public {
        vm.expectRevert(bytes("AvaKitNFT: nonexistent token"));
        nft.ownerOf(999);
    }

    // ---- approvals ----

    function test_ApproveSetsApproval() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectEmit(true, true, true, false);
        emit Approval(ALICE, BOB, id);
        vm.prank(ALICE);
        nft.approve(BOB, id);

        assertEq(nft.getApproved(id), BOB, "approved");
    }

    function test_ApproveRevertsForStranger() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert(bytes("AvaKitNFT: not authorized to approve"));
        vm.prank(BOB);
        nft.approve(BOB, id);
    }

    function test_SetApprovalForAll() public {
        vm.expectEmit(true, true, false, true);
        emit ApprovalForAll(ALICE, BOB, true);
        vm.prank(ALICE);
        nft.setApprovalForAll(BOB, true);

        assertTrue(nft.isApprovedForAll(ALICE, BOB), "operator set");

        // An operator can approve on the owner's behalf.
        vm.prank(ALICE);
        uint256 id = nft.mint();
        vm.prank(BOB);
        nft.approve(CAROL, id);
        assertEq(nft.getApproved(id), CAROL, "operator-set approval");
    }

    // ---- transfers ----

    function test_TransferFromMovesToken() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectEmit(true, true, true, false);
        emit Transfer(ALICE, BOB, id);
        vm.prank(ALICE);
        nft.transferFrom(ALICE, BOB, id);

        assertEq(nft.ownerOf(id), BOB, "new owner");
        assertEq(nft.balanceOf(ALICE), 0, "alice balance");
        assertEq(nft.balanceOf(BOB), 1, "bob balance");
    }

    function test_TransferFromClearsApproval() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();
        vm.prank(ALICE);
        nft.approve(BOB, id);

        vm.prank(BOB);
        nft.transferFrom(ALICE, CAROL, id);

        assertEq(nft.getApproved(id), address(0), "approval cleared");
        assertEq(nft.ownerOf(id), CAROL, "new owner");
    }

    function test_TransferFromRevertsForStranger() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert(bytes("AvaKitNFT: not authorized to transfer"));
        vm.prank(BOB);
        nft.transferFrom(ALICE, BOB, id);
    }

    function test_TransferFromRevertsForWrongFrom() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert(bytes("AvaKitNFT: from is not the owner"));
        vm.prank(ALICE);
        nft.transferFrom(BOB, CAROL, id);
    }

    function test_TransferFromRevertsToZeroAddress() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert(bytes("AvaKitNFT: transfer to the zero address"));
        vm.prank(ALICE);
        nft.transferFrom(ALICE, address(0), id);
    }

    function test_OperatorCanTransfer() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();
        vm.prank(ALICE);
        nft.setApprovalForAll(BOB, true);

        vm.prank(BOB);
        nft.transferFrom(ALICE, CAROL, id);
        assertEq(nft.ownerOf(id), CAROL, "operator transfer");
    }

    // ---- safe transfers ----

    function test_SafeTransferToEoa() public {
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.prank(ALICE);
        nft.safeTransferFrom(ALICE, BOB, id);
        assertEq(nft.ownerOf(id), BOB, "safe transfer to EOA");
    }

    function test_SafeTransferToReceiverContract() public {
        GoodReceiver receiver = new GoodReceiver();
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.prank(ALICE);
        nft.safeTransferFrom(ALICE, address(receiver), id);

        assertEq(nft.ownerOf(id), address(receiver), "receiver owns token");
        assertEq(receiver.lastOperator(), ALICE, "operator recorded");
        assertEq(receiver.lastFrom(), ALICE, "from recorded");
        assertEq(receiver.lastTokenId(), id, "tokenId recorded");
    }

    function test_SafeTransferRevertsForBadReceiver() public {
        BadReceiver bad = new BadReceiver();
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert(bytes("AvaKitNFT: receiver rejected the token"));
        vm.prank(ALICE);
        nft.safeTransferFrom(ALICE, address(bad), id);
    }

    function test_SafeTransferRevertsForNonReceiverContract() public {
        // The test contract itself implements no onERC721Received.
        vm.prank(ALICE);
        uint256 id = nft.mint();

        vm.expectRevert();
        vm.prank(ALICE);
        nft.safeTransferFrom(ALICE, address(this), id);
    }

    // ---- tokenURI (on-chain generative art) ----

    function test_TokenUriIsOnChainDataUri() public {
        vm.prank(ALICE);
        uint256 tokenId = nft.mint();

        string memory uri = nft.tokenURI(tokenId);
        assertTrue(
            startsWith(uri, "data:application/json;utf8,{"),
            "JSON data URI prefix"
        );
        // The art must be embedded, not referenced: no server, no IPFS.
        assertTrue(
            _contains(uri, "data:image/svg+xml;utf8,"),
            "embedded SVG image"
        );
        assertTrue(_contains(uri, "AVAKIT"), "wordmark in the art");
    }

    function test_TokenUriIsReproducibleFromChainState() public {
        vm.prank(ALICE);
        uint256 tokenId = nft.mint();

        // view function over fixed chain state => identical output every call
        assertEq(
            nft.tokenURI(tokenId),
            nft.tokenURI(tokenId),
            "deterministic tokenURI"
        );
    }

    function test_TokenUriDiffersPerToken() public {
        vm.prank(ALICE);
        uint256 a = nft.mint();
        vm.prank(ALICE);
        uint256 b = nft.mint();

        // Different (tokenId, owner) seeds may share a palette (6 palettes),
        // but the card always carries the zero-padded token number.
        assertTrue(_contains(nft.tokenURI(a), "%23001"), "card number #001");
        assertTrue(_contains(nft.tokenURI(b), "%23002"), "card number #002");
    }

    // ---- helpers ----

    function _contains(
        string memory haystack,
        string memory needle
    ) private pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }
}
