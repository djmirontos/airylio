/**
 * Address formatting shared by the screens that show a picked location.
 */

/**
 * Open Location Code ("plus code") such as 2QVR+697 or 3P7W+GG4.
 *
 * The alphabet is deliberately restricted - 23456789CFGHJMPQRVWX - to avoid
 * characters that look alike or spell words, so this will not match ordinary
 * address text.
 */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

export function isPlusCode(segment: string): boolean {
  return PLUS_CODE.test(segment.trim());
}

/**
 * Splits a Google formatted address into a headline and a supporting line.
 *
 * "SM Megamall, Ortigas Center, Mandaluyong"
 *   -> name "SM Megamall", detail "Ortigas Center, Mandaluyong"
 *
 * Google uses a plus code as the street-address component when a location has
 * no street address, which is common outside major Philippine business
 * districts. Leading with it gives the user a grid reference they cannot
 * recognise, so the next segment is promoted instead and the code moves to the
 * end of the detail line - still present to tell two nearby points apart, but
 * no longer the headline:
 *
 * "2QVR+697, Tubod, Lanao del Norte"
 *   -> name "Tubod", detail "Lanao del Norte · 2QVR+697"
 *
 * Labels without a comma, such as "Current Location", return an empty detail
 * and render as a single line.
 */
export function splitAddress(label: string): { name: string; detail: string } {
  const raw = (label ?? '').trim();
  // Dropping empty segments keeps a stray leading comma from producing an empty
  // name and repeating the same text on both lines.
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { name: raw, detail: '' };

  if (isPlusCode(parts[0]) && parts.length > 1) {
    const rest = parts.slice(2);
    const detail = rest.length ? `${rest.join(', ')} · ${parts[0]}` : parts[0];
    return { name: parts[1], detail };
  }

  return { name: parts[0], detail: parts.slice(1).join(', ') };
}
