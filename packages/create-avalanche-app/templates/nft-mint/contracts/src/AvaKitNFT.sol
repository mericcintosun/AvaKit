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
        (string memory accent, string memory paletteName, string memory muzzle) = _palette(seed);

        string memory art = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'>",
            "<rect width='600' height='600' fill='rgb(9,9,11)'/>",
            // A real radial falloff. A flat circle at low opacity reads as a disc
            // with a visible edge, not a glow. `url(%2523g)` is double-encoded for
            // the same nested-data-URI reason as the `#` in the type.
            "<defs><radialGradient id='g' cx='0.5' cy='0.46' r='0.6'><stop offset='0' stop-color='",
            accent,
            "' stop-opacity='0.20'/><stop offset='1' stop-color='",
            accent,
            "' stop-opacity='0'/></radialGradient></defs>",
            "<rect width='600' height='600' fill='url(%2523g)'/>",
            "<rect x='32' y='32' width='536' height='536' fill='none' stroke='rgb(39,39,42)'/>",
            _fox(accent, muzzle),
            _type(tokenId, accent, paletteName)
        );

        return string.concat(
            'data:application/json;utf8,{"name":"AvaKit %23',
            _pad3(tokenId),
            '","description":"Minted in about a minute at avakit.dev/new - no install, ',
            'no signup, no seed phrase, no gas. The art is generated on-chain from this ',
            'token, by the contract you deployed.",',
            '"attributes":[{"trait_type":"Palette","value":"',
            paletteName,
            '"}],"image":"data:image/svg+xml;utf8,',
            art,
            '"}'
        );
    }

    /// @dev AvaFox, drawn as flat geometry — the same faceted, angular character
    ///      as the mascot, but a few hundred bytes of path data instead of a
    ///      raster. The silhouette never varies; only the palette does.
    function _fox(string memory accent, string memory muzzle) private pure returns (string memory) {
        return string.concat(
            // ears
            "<path d='M200 240 L226 108 L298 192 Z' fill='",
            accent,
            "'/><path d='M400 240 L374 108 L302 192 Z' fill='",
            accent,
            "'/><path d='M218 222 L234 148 L274 190 Z' fill='rgb(9,9,11)'/>",
            "<path d='M382 222 L366 148 L326 190 Z' fill='rgb(9,9,11)'/>",
            // head
            "<path d='M200 240 L300 196 L400 240 L300 404 Z' fill='",
            accent,
            // cheek facets — the low-poly shading, done with opacity so one accent
            // colour yields both a lit and a shaded plane
            "'/><path d='M200 240 L300 196 L300 300 Z' fill='rgb(255,255,255)' opacity='0.10'/>",
            "<path d='M400 240 L300 196 L300 300 Z' fill='rgb(0,0,0)' opacity='0.14'/>",
            // muzzle + nose
            "<path d='M300 404 L256 322 L300 302 L344 322 Z' fill='",
            muzzle,
            "'/><path d='M300 372 L288 352 L312 352 Z' fill='rgb(9,9,11)'/>",
            // eyes
            "<path d='M246 254 L284 264 L282 276 L248 268 Z' fill='rgb(9,9,11)'/>",
            "<path d='M354 254 L316 264 L318 276 L352 268 Z' fill='rgb(9,9,11)'/>"
        );
    }

    /// @dev Spec-card typography. A real font stack, not bare `monospace` — the
    ///      default fallback renders soft and rounded and cheapens the whole card.
    ///      %2523, not %23: this SVG is a data URI nested inside the JSON data URI,
    ///      so it is percent-decoded twice (once reading tokenURI, once when the
    ///      browser loads the image). Single-encoding would leak a raw `#` into the
    ///      image src and truncate the SVG.
    function _type(uint256 tokenId, string memory accent, string memory paletteName)
        private
        pure
        returns (string memory)
    {
        string memory f =
            " font-family='ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'";
        return string.concat(
            "<text x='64' y='78'",
            f,
            " font-size='13' letter-spacing='3' fill='rgb(113,113,122)'>AVALANCHE FUJI</text>",
            "<text x='536' y='78' text-anchor='end'",
            f,
            " font-size='13' letter-spacing='3' fill='",
            accent,
            "'>",
            paletteName,
            "</text>",
            "<line x1='64' y1='498' x2='536' y2='498' stroke='rgb(39,39,42)'/>",
            "<text x='64' y='534'",
            f,
            " font-size='20' letter-spacing='6' fill='rgb(250,250,250)'>AVAKIT</text>",
            "<text x='536' y='534' text-anchor='end'",
            f,
            " font-size='20' fill='",
            accent,
            "'>%2523",
            _pad3(tokenId),
            "</text></svg>"
        );
    }

    /// @dev Zero-padded to three digits, so the card reads `#007`, not `#7`.
    function _pad3(uint256 v) private pure returns (string memory) {
        if (v < 10) return string.concat("00", _toString(v));
        if (v < 100) return string.concat("0", _toString(v));
        return _toString(v);
    }

    /// @dev Variation stays inside the Ember Crimson family so every token still
    ///      reads as AvaKit — random must not mean off-brand.
    /// @dev accent, name, muzzle. Variation stays inside the Ember Crimson family
    ///      so every token still reads as AvaKit — random must not mean off-brand.
    function _palette(uint256 seed)
        private
        pure
        returns (string memory, string memory, string memory)
    {
        string memory white = "rgb(250,250,250)";
        uint256 i = seed % 6;
        if (i == 0) return ("rgb(225,29,72)", "EMBER", white);
        if (i == 1) return ("rgb(244,63,94)", "ROSE", white);
        if (i == 2) return ("rgb(159,18,57)", "DEEP", white);
        if (i == 3) return ("rgb(220,38,38)", "SIGNAL", white);
        if (i == 4) return ("rgb(234,88,12)", "MAGMA", white);
        // the monochrome cut: an arctic AvaFox, a nod to the 3D one
        return ("rgb(244,244,245)", "ASH", "rgb(113,113,122)");
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
