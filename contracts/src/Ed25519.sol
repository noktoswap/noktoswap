// From https://github.com/javgh/ed25519-solidity/blob/master/contract/Ed25519.sol
//
// Copyright (c) 2019, Jan Vornberger - licensed under the MIT license
//
// converted to a library by hbs in 2025 to avoid having to deploy a specific Ed22519 contract

pragma solidity ^0.8.34;

// Using formulas from https://hyperelliptic.org/EFD/g1p/auto-twisted-projective.html
// and constants from https://tools.ietf.org/html/draft-josefsson-eddsa-ed25519-03

library Ed25519 {
    uint256 constant q = 2 ** 255 - 19;
    uint256 constant l = 2 ** 252 + 27742317777372353535851937790883648493;
    uint256 constant d = 37095705934669439343138083508754565189542113879843219016388785533085940283555;
    // = -(121665/121666)
    uint256 constant Bx = 15112221349535400772501151409588531511454012693041857206046113283949847762202;
    uint256 constant By = 46316835694926478169428394003475163141307993866256225615783033603165251855960;

    error InvalidScalar();

    function inv(uint256 a) internal view returns (uint256 invA) {
        uint256 e = q - 2;
        uint256 m = q;

        // use bigModExp precompile
        assembly ("memory-safe") {
            let p := mload(0x40)
            // WARNING: this line was added and magically made it work
            mstore(0x40, add(p, 0xc0))
            // THIS IS THE END OF THAT LINE THAT WAS ADDED thank u

            mstore(p, 0x20)
            mstore(add(p, 0x20), 0x20)
            mstore(add(p, 0x40), 0x20)
            mstore(add(p, 0x60), a)
            mstore(add(p, 0x80), e)
            mstore(add(p, 0xa0), m)
            if iszero(staticcall(not(0), 0x05, p, 0xc0, p, 0x20)) {
                revert(0, 0)
            }
            invA := mload(p)
        }
    }

    function ecAdd(uint256 x1, uint256 y1, uint256 z1, uint256 x2, uint256 y2, uint256 z2)
        internal
        pure
        returns (uint256 x3, uint256 y3, uint256 z3)
    {
        uint256 a = mulmod(z1, z2, q);
        uint256 b = mulmod(a, a, q);
        uint256 c = mulmod(x1, x2, q);
        uint256 dd = mulmod(y1, y2, q);
        uint256 e = mulmod(d, mulmod(c, dd, q), q);
        uint256 f = addmod(b, q - e, q);
        uint256 g = addmod(b, e, q);
        x3 = mulmod(
            mulmod(a, f, q),
            addmod(addmod(mulmod(addmod(x1, y1, q), addmod(x2, y2, q), q), q - c, q), q - dd, q),
            q
        );
        y3 = mulmod(mulmod(a, g, q), addmod(dd, c, q), q);
        z3 = mulmod(f, g, q);
    }

    function ecDouble(uint256 x1, uint256 y1, uint256 z1)
        internal
        pure
        returns (uint256 x2, uint256 y2, uint256 z2)
    {
        uint256 a = addmod(x1, y1, q);
        uint256 b = mulmod(a, a, q);
        uint256 c = mulmod(x1, x1, q);
        uint256 dd = mulmod(y1, y1, q);
        uint256 e = q - c;
        uint256 f = addmod(e, dd, q);
        uint256 h = mulmod(z1, z1, q);
        uint256 g = addmod(f, q - mulmod(2, h, q), q);
        x2 = mulmod(addmod(addmod(b, q - c, q), q - dd, q), g, q);
        y2 = mulmod(f, addmod(e, q - dd, q), q);
        z2 = mulmod(f, g, q);
    }

    function scalarMultBase(uint256 s) internal view returns (uint256, uint256) {
        (uint256 x, uint256 y, uint256 z) = scalarMultBaseProjective(s);
        uint256 invZ = inv(z);

        return (mulmod(x, invZ, q), mulmod(y, invZ, q));
    }

    function scalarMultBaseCompressed(uint256 s) internal view returns (uint256) {
        (uint256 x, uint256 y, uint256 z) = scalarMultBaseProjective(s);
        uint256 invZ = inv(z);
        x = mulmod(x, invZ, q);
        y = mulmod(y, invZ, q);

        return compressPointLittleEndian(x, y);
    }

    function scalarMultBaseProjective(uint256 s) internal pure returns (uint256 x, uint256 y, uint256 z) {
        if (s == 0 || s >= l) revert InvalidScalar();

        x = 0;
        y = 1;
        z = 1;

        uint256 shift = 252;
        bool started;
        while (true) {
            if (started) {
                (x, y, z) = ecDouble(x, y, z);
                (x, y, z) = ecDouble(x, y, z);
                (x, y, z) = ecDouble(x, y, z);
                (x, y, z) = ecDouble(x, y, z);
            }

            uint256 window = (s >> shift) & 0xf;
            if (window != 0) {
                (uint256 tableX, uint256 tableY) = baseMultiple(window);
                (x, y, z) = ecAdd(x, y, z, tableX, tableY, 1);
                started = true;
            }

            if (shift == 0) break;
            shift -= 4;
        }
    }

    function baseMultiple(uint256 window) internal pure returns (uint256 x, uint256 y) {
        if (window == 1) {
            return (Bx, By);
        } else if (window == 2) {
            return (
                24727413235106541002554574571675588834622768167397638456726423682521233608206,
                15549675580280190176352668710449542251549572066445060580507079593062643049417
            );
        } else if (window == 3) {
            return (
                46896733464454938657123544595386787789046198280132665686241321779790909858396,
                8324843778533443976490377120369201138301417226297555316741202210403726505172
            );
        } else if (window == 4) {
            return (
                14582954232372986451776170844943001818709880559417862259286374126315108956272,
                32483318716863467900234833297694612235682047836132991208333042722294373421359
            );
        } else if (window == 5) {
            return (
                33467004535436536005251147249499675200073690106659565782908757308821616914995,
                43097193783671926753355113395909008640284023746042808659097434958891230611693
            );
        } else if (window == 6) {
            return (
                34643617590234865996699167120328052565261792237873803846102513686264813449789,
                2399184961499513294557607325187831088545696902880432827228757905043131825908
            );
        } else if (window == 7) {
            return (
                9199134265559022971505535402808359556995554859516252602543778295037484220679,
                22512087849695599276028560866629687720820254811233262850576678203618951717560
            );
        } else if (window == 8) {
            return (
                46706390780465557264338673484185971070529246228527338942042475661633188627656,
                15299170165656271974649334809062094114079726227711063015095704409550798436788
            );
        } else if (window == 9) {
            return (
                24193060302538010417230488029838514081720802923509845138863968807030823940444,
                57551756252899625001155759838357770487605224608455116862194664796369308545472
            );
        } else if (window == 10) {
            return (
                43500613248243327786121022071801015118933854441360174117148262713429272820047,
                45005105423099817237495816771148012388779685712352441364231470781391834741548
            );
        } else if (window == 11) {
            return (
                9451145793506787353375160377761530931587019091193333050860601958827395183563,
                20609402718286069808115703540855311742885093522056241285814584245966805874451
            );
        } else if (window == 12) {
            return (
                32159939716063394567822525359727347405356413309540137282993608327129696604205,
                29147333543209904737197244325450674102993621692520459538942544703173373584633
            );
        } else if (window == 13) {
            return (
                7442235066513780790779899786332475485840754593728627195931759107337804079085,
                8529785864514984411577036536286432879603480171865651918962709025066066124672
            );
        } else if (window == 14) {
            return (
                14642270634066990240227516988620748386040643134865523775420225321890511918521,
                35422008320351900419562335198749713095866812710345432231966142485751234570297
            );
        } else {
            return (
                35771902585589234259498423420223840099331465042459337605611172842168536632769,
                8502034780705657720897159939055122322178084209392286764802307224484658961631
            );
        }
    }

    function changeEndianness(uint256 _bigEnd) internal pure returns (uint256) {
        uint256 shifted = 0;
        uint256 i = 32;
        while (i > 0) {
            shifted <<= 8;
            shifted |= _bigEnd & 0xff;
            _bigEnd >>= 8;
            i--;
        }
        return shifted;
    }

    function compressPoint(uint256 x, uint256 y) internal pure returns (uint256) {
        uint256 compressed = y | ((x & 1) << 255);
        // Return is in Big Endian order - need to change endianness to stick to Monero's convention of using Little Endian
        return compressed;
    }

    function compressPointLittleEndian(uint256 x, uint256 y) internal pure returns (uint256) {
        // In little-endian compressed Ed25519 encoding, the sign bit is bit 7 of byte 31.
        return changeEndianness(y) | ((x & 1) << 7);
    }
}
