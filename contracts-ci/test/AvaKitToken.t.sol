// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TestBase} from "./TestBase.sol";
import {AvaKitToken} from "../src/AvaKitToken.sol";

contract AvaKitTokenTest is TestBase {
    AvaKitToken internal token;

    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    uint256 internal constant FAUCET_AMOUNT = 100 ether; // 100 AKT, 18 decimals

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function setUp() public {
        token = new AvaKitToken();
    }

    // ---- mint (demo faucet) ----

    function test_MintCreditsCallerAndSupply() public {
        vm.prank(ALICE);
        token.mint();

        assertEq(token.balanceOf(ALICE), FAUCET_AMOUNT, "alice balance");
        assertEq(token.totalSupply(), FAUCET_AMOUNT, "totalSupply");
    }

    function test_MintAccumulates() public {
        vm.prank(ALICE);
        token.mint();
        vm.prank(ALICE);
        token.mint();
        vm.prank(BOB);
        token.mint();

        assertEq(token.balanceOf(ALICE), 2 * FAUCET_AMOUNT, "alice balance");
        assertEq(token.balanceOf(BOB), FAUCET_AMOUNT, "bob balance");
        assertEq(token.totalSupply(), 3 * FAUCET_AMOUNT, "totalSupply");
    }

    function test_MintEmitsTransferFromZero() public {
        vm.expectEmit(true, true, false, true);
        emit Transfer(address(0), ALICE, FAUCET_AMOUNT);
        vm.prank(ALICE);
        token.mint();
    }

    // ---- transfer ----

    function test_TransferMovesBalance() public {
        vm.prank(ALICE);
        token.mint();

        vm.expectEmit(true, true, false, true);
        emit Transfer(ALICE, BOB, 40 ether);
        vm.prank(ALICE);
        assertTrue(token.transfer(BOB, 40 ether), "transfer returns true");

        assertEq(token.balanceOf(ALICE), 60 ether, "alice after");
        assertEq(token.balanceOf(BOB), 40 ether, "bob after");
        assertEq(token.totalSupply(), FAUCET_AMOUNT, "supply unchanged");
    }

    function test_TransferRevertsOnInsufficientBalance() public {
        vm.prank(ALICE);
        token.mint();

        // Checked arithmetic underflow => Panic(0x11).
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        vm.prank(ALICE);
        token.transfer(BOB, FAUCET_AMOUNT + 1);
    }

    // ---- approve / transferFrom ----

    function test_ApproveSetsAllowance() public {
        vm.expectEmit(true, true, false, true);
        emit Approval(ALICE, BOB, 25 ether);
        vm.prank(ALICE);
        assertTrue(token.approve(BOB, 25 ether), "approve returns true");

        assertEq(token.allowance(ALICE, BOB), 25 ether, "allowance");
    }

    function test_TransferFromSpendsAllowance() public {
        vm.prank(ALICE);
        token.mint();
        vm.prank(ALICE);
        token.approve(BOB, 25 ether);

        vm.prank(BOB);
        assertTrue(
            token.transferFrom(ALICE, BOB, 10 ether),
            "transferFrom returns true"
        );

        assertEq(token.balanceOf(ALICE), 90 ether, "alice after");
        assertEq(token.balanceOf(BOB), 10 ether, "bob after");
        assertEq(token.allowance(ALICE, BOB), 15 ether, "allowance spent");
    }

    function test_TransferFromRevertsBeyondAllowance() public {
        vm.prank(ALICE);
        token.mint();
        vm.prank(ALICE);
        token.approve(BOB, 5 ether);

        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        vm.prank(BOB);
        token.transferFrom(ALICE, BOB, 6 ether);
    }

    function test_TransferFromRevertsWithoutApproval() public {
        vm.prank(ALICE);
        token.mint();

        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", 0x11));
        vm.prank(BOB);
        token.transferFrom(ALICE, BOB, 1);
    }

    // ---- metadata ----

    function test_Metadata() public view {
        assertEq(token.name(), "AvaKit Token", "name");
        assertEq(token.symbol(), "AKT", "symbol");
        assertEq(uint256(token.decimals()), 18, "decimals");
    }
}
