import crypto from "crypto";

const CONSONANTS = "bcdfghjkmnpqrstvwxyz";
const VOWELS = "aeiou";
const DIGITS = "23456789";

/**
 * Generates a hyphenated, pseudo-pronounceable password that mimics Apple's
 * "easy to type" format:
 *   - Three segments joined by hyphens (e.g., `fobzan-Merqon-kulso4`)
 *   - Each segment is built from consonant-vowel-consonant syllables so it
 *     remains readable on limited keyboards
 *   - Exactly one uppercase letter and one digit are distributed randomly
 *     across the segments to satisfy common password rules while keeping the
 *     string simple to type
 * @returns A password string such as `fobzan-Merqon-kulso4`
 */
export function generateFriendlyPassword() {
    const random = (charset: string) => charset[crypto.randomInt(0, charset.length)];

    const buildSyllable = () => `${random(CONSONANTS)}${random(VOWELS)}${random(CONSONANTS)}`;
    const buildSegment = () => (buildSyllable() + buildSyllable()).slice(0, 6); // pseudo-word ~6 chars

    const segments = [buildSegment(), buildSegment(), buildSegment()];

    const uppercaseSegmentIndex = crypto.randomInt(0, segments.length);
    const uppercaseCharIndex = crypto.randomInt(0, segments[uppercaseSegmentIndex].length);
    segments[uppercaseSegmentIndex] =
        segments[uppercaseSegmentIndex].slice(0, uppercaseCharIndex) +
        segments[uppercaseSegmentIndex][uppercaseCharIndex].toUpperCase() +
        segments[uppercaseSegmentIndex].slice(uppercaseCharIndex + 1);

    const digitSegmentIndex = crypto.randomInt(0, segments.length);
    const digitCharIndex = crypto.randomInt(0, segments[digitSegmentIndex].length);
    segments[digitSegmentIndex] =
        segments[digitSegmentIndex].slice(0, digitCharIndex) +
        random(DIGITS) +
        segments[digitSegmentIndex].slice(digitCharIndex + 1);

    return segments.join("-");
}