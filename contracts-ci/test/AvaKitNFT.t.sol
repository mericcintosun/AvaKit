// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TestBase} from "./TestBase.sol";
import {AvaKitNFT} from "../src/AvaKitNFT.sol";

contract AvaKitNFTTest is TestBase {
    AvaKitNFT internal nft;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);

    event Transfer(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
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
