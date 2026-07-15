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

    /// @dev Eight points on a circle (centre 300,300 · r 220) — a lookup, so we
    ///      never do trigonometry on-chain. (Solidity has no array constants, so
    ///      this is a function rather than a `constant`.)
    function _orbitPoint(uint256 p) private pure returns (uint256 x, uint256 y) {
        if (p == 0) return (520, 300);
        if (p == 1) return (455, 455);
        if (p == 2) return (300, 520);
        if (p == 3) return (145, 455);
        if (p == 4) return (80, 300);
        if (p == 5) return (145, 145);
        if (p == 6) return (300, 80);
        return (455, 145);
    }

    /// @notice Each token's art is derived from the token itself — no oracle, no
    ///         server, no IPFS, no automation. `tokenURI` is a `view`, so the
    ///         image is reproducible from chain state forever.
    /// @dev On randomness: this is deliberately NOT Chainlink VRF. VRF buys
    ///      *unpredictability*, which matters when someone can profit by
    ///      re-rolling. Here the token is a free memento with no market, so what
    ///      we actually need is *variety* — and keccak over (tokenId, owner,
    ///      chainid) gives that instantly, for free, with zero dependencies. If
    ///      you fork this into something with real rarity value, that is when you
    ///      reach for VRF.
    /// @dev Three data-URI rules this has to respect, each easy to get wrong:
    ///      (1) a raw `#` starts a URI fragment and would truncate the JSON, so
    ///      `#` is percent-encoded — and `%` is an escape prefix, so colours are
    ///      rgb() rather than hsl(...%); (2) the SVG sits inside a double-quoted
    ///      JSON string, so its attributes use single quotes; (3) no `"` anywhere
    ///      inside the SVG.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        uint256 seed = uint256(
            keccak256(abi.encodePacked(tokenId, ownerOf[tokenId], block.chainid))
        );
        string memory id = _toString(tokenId);
        (string memory glow, string memory paletteName) = _palette(seed);
        uint256 dots = 3 + (seed >> 8) % 6; // 3..8

        string memory art = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'>",
            "<rect width='600' height='600' fill='rgb(9,9,11)'/>",
            _orbit(seed, dots, glow),
            // The brand anchor never varies: the AvaKit triangle, always.
            "<path d='M300 168 L412 404 L188 404 Z' fill='",
            glow,
            "'/><path d='M300 168 L356 286 L244 286 Z' fill='rgb(250,250,250)' opacity='0.92'/>",
            // %2523, not %23: this SVG is a data URI *nested inside* the JSON data
            // URI, so it gets percent-decoded twice — once when the tokenURI is
            // read, once when the browser loads the image. Single-encoding here
            // would surface a raw `#` in the image src and truncate the SVG.
            "<text x='300' y='486' text-anchor='middle' font-family='monospace' font-size='40' fill='rgb(250,250,250)'>AvaKit %2523",
            id,
            "</text><text x='300' y='524' text-anchor='middle' font-family='monospace' font-size='17' fill='rgb(161,161,170)'>built on Avalanche in 60 seconds</text></svg>"
        );

        return string.concat(
            'data:application/json;utf8,{"name":"AvaKit %23',
            id,
            '","description":"Minted in about a minute at avakit.dev/new - no install, ',
            'no signup, no seed phrase, no gas. Art generated on-chain from this token.",',
            '"attributes":[{"trait_type":"Palette","value":"',
            paletteName,
            '"},{"trait_type":"Orbit","value":',
            _toString(dots),
            '}],"image":"data:image/svg+xml;utf8,',
            art,
            '"}'
        );
    }

    /// @dev Variation stays inside the Ember Crimson family so every token still
    ///      reads as AvaKit — random must not mean off-brand.
    function _palette(uint256 seed) private pure returns (string memory, string memory) {
        uint256 i = seed % 6;
        if (i == 0) return ("rgb(225,29,72)", "Ember");
        if (i == 1) return ("rgb(244,63,94)", "Rose");
        if (i == 2) return ("rgb(251,113,133)", "Blush");
        if (i == 3) return ("rgb(190,18,60)", "Deep");
        if (i == 4) return ("rgb(239,68,68)", "Signal");
        return ("rgb(249,115,22)", "Magma");
    }

    /// @dev Scatter `dots` seeded points from the ORBIT table, plus a soft glow.
    function _orbit(uint256 seed, uint256 dots, string memory glow)
        private
        pure
        returns (string memory out)
    {
        out = string.concat(
            "<circle cx='300' cy='300' r='250' fill='",
            glow,
            "' opacity='0.06'/>"
        );
        uint256 offset = (seed >> 16) % 8;
        for (uint256 k = 0; k < dots; k++) {
            (uint256 x, uint256 y) = _orbitPoint((offset + k) % 8);
            uint256 r = 4 + ((seed >> (24 + k * 3)) % 9); // 4..12
            out = string.concat(
                out,
                "<circle cx='",
                _toString(x),
                "' cy='",
                _toString(y),
                "' r='",
                _toString(r),
                "' fill='",
                glow,
                "' opacity='0.55'/>"
            );
        }
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
