// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev The subset of Foundry cheatcodes these tests use, inlined so the
/// harness has zero dependencies — the same spirit as the template contracts
/// themselves (AvaKitMessenger inlines its ICM interfaces the same way).
/// Reference: https://getfoundry.sh/reference/cheatcodes/
interface Vm {
    /// Sets msg.sender for the next external call.
    function prank(address caller) external;

    /// Replaces the code at `target` with `code`.
    function etch(address target, bytes calldata code) external;

    /// Expects the next external call to revert with exact `revertData`.
    function expectRevert(bytes calldata revertData) external;

    /// Expects the next external call to revert with any data.
    function expectRevert() external;

    /// Expects the next emitted event to match (topics checked per flag).
    function expectEmit(bool t1, bool t2, bool t3, bool checkData) external;
}

/// @dev Minimal assertion base. Failures revert with a labelled message,
/// which is how forge reports assertion failures without forge-std.
abstract contract TestBase {
    /// keccak256("hevm cheat code") = 0x7109709ECfa91a80626fF3989D68f67F5b1DD12D
    Vm internal constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertEq(uint256 a, uint256 b, string memory label) internal pure {
        if (a != b) revert(string.concat("assertEq(uint) failed: ", label));
    }

    function assertEq(address a, address b, string memory label) internal pure {
        if (a != b) revert(string.concat("assertEq(address) failed: ", label));
    }

    function assertEq(bytes32 a, bytes32 b, string memory label) internal pure {
        if (a != b) revert(string.concat("assertEq(bytes32) failed: ", label));
    }

    function assertEq(
        string memory a,
        string memory b,
        string memory label
    ) internal pure {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            revert(string.concat("assertEq(string) failed: ", label));
        }
    }

    function assertTrue(bool ok, string memory label) internal pure {
        if (!ok) revert(string.concat("assertTrue failed: ", label));
    }

    function startsWith(
        string memory str,
        string memory prefix
    ) internal pure returns (bool) {
        bytes memory s = bytes(str);
        bytes memory p = bytes(prefix);
        if (p.length > s.length) return false;
        for (uint256 i = 0; i < p.length; i++) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }
}
