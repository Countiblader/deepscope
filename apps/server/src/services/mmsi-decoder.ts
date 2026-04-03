/**
 * MMSI Decoder - extracts flag state from Maritime Mobile Service Identity numbers.
 *
 * The first 3 digits of an MMSI (the MID - Maritime Identification Digit)
 * identify the flag state. This module provides a comprehensive mapping
 * of MID codes to country information, with special attention to
 * flags of convenience commonly used by shadow fleet vessels.
 */

export interface FlagInfo {
  code: string;      // ISO 3166-1 alpha-2
  name: string;
  isFlagOfConvenience: boolean;
}

// Flags of convenience - countries known for open registries
const FLAGS_OF_CONVENIENCE = new Set([
  'PA', // Panama
  'LR', // Liberia
  'MH', // Marshall Islands
  'BS', // Bahamas
  'MT', // Malta
  'CY', // Cyprus
  'BM', // Bermuda
  'VU', // Vanuatu
  'AG', // Antigua and Barbuda
  'KN', // Saint Kitts and Nevis
  'VC', // Saint Vincent and the Grenadines
  'BB', // Barbados
  'HN', // Honduras
  'BO', // Bolivia
  'CM', // Cameroon
  'KM', // Comoros
  'PW', // Palau
  'GA', // Gabon
  'TZ', // Tanzania
  'TG', // Togo
  'SL', // Sierra Leone
  'GQ', // Equatorial Guinea
  'MN', // Mongolia
  'MM', // Myanmar
  'KH', // Cambodia
  'LB', // Lebanon
  'MD', // Moldova
  'GE', // Georgia
  'DJ', // Djibouti
  'CD', // Democratic Republic of Congo
]);

/**
 * MID (Maritime Identification Digit) to country mapping.
 * Covers all ITU-assigned MID codes for major shipping nations.
 */
const MID_TO_COUNTRY: Record<number, FlagInfo> = {
  // Afghanistan (MID 410)
  410: { code: 'AF', name: 'Afghanistan', isFlagOfConvenience: false },

  // Albania
  201: { code: 'AL', name: 'Albania', isFlagOfConvenience: false },

  // Algeria
  605: { code: 'DZ', name: 'Algeria', isFlagOfConvenience: false },

  // Angola
  603: { code: 'AO', name: 'Angola', isFlagOfConvenience: false },

  // Antigua and Barbuda
  304: { code: 'AG', name: 'Antigua and Barbuda', isFlagOfConvenience: true },
  305: { code: 'AG', name: 'Antigua and Barbuda', isFlagOfConvenience: true },

  // Argentina
  701: { code: 'AR', name: 'Argentina', isFlagOfConvenience: false },

  // Australia
  503: { code: 'AU', name: 'Australia', isFlagOfConvenience: false },

  // Bahamas
  308: { code: 'BS', name: 'Bahamas', isFlagOfConvenience: true },
  309: { code: 'BS', name: 'Bahamas', isFlagOfConvenience: true },
  311: { code: 'BS', name: 'Bahamas', isFlagOfConvenience: true },

  // Bahrain
  408: { code: 'BH', name: 'Bahrain', isFlagOfConvenience: false },

  // Bangladesh
  405: { code: 'BD', name: 'Bangladesh', isFlagOfConvenience: false },

  // Barbados
  314: { code: 'BB', name: 'Barbados', isFlagOfConvenience: true },

  // Belgium
  205: { code: 'BE', name: 'Belgium', isFlagOfConvenience: false },
  206: { code: 'BE', name: 'Belgium', isFlagOfConvenience: false },

  // Belize
  312: { code: 'BZ', name: 'Belize', isFlagOfConvenience: true },

  // Bermuda
  310: { code: 'BM', name: 'Bermuda', isFlagOfConvenience: true },

  // Bolivia
  720: { code: 'BO', name: 'Bolivia', isFlagOfConvenience: true },

  // Brazil
  710: { code: 'BR', name: 'Brazil', isFlagOfConvenience: false },

  // Brunei
  508: { code: 'BN', name: 'Brunei', isFlagOfConvenience: false },

  // Bulgaria
  207: { code: 'BG', name: 'Bulgaria', isFlagOfConvenience: false },

  // Cambodia
  514: { code: 'KH', name: 'Cambodia', isFlagOfConvenience: true },
  515: { code: 'KH', name: 'Cambodia', isFlagOfConvenience: true },

  // Cameroon
  613: { code: 'CM', name: 'Cameroon', isFlagOfConvenience: true },

  // Canada
  316: { code: 'CA', name: 'Canada', isFlagOfConvenience: false },

  // Cayman Islands
  319: { code: 'KY', name: 'Cayman Islands', isFlagOfConvenience: true },

  // Chile
  725: { code: 'CL', name: 'Chile', isFlagOfConvenience: false },

  // China
  412: { code: 'CN', name: 'China', isFlagOfConvenience: false },
  413: { code: 'CN', name: 'China', isFlagOfConvenience: false },
  414: { code: 'CN', name: 'China', isFlagOfConvenience: false },

  // Colombia
  730: { code: 'CO', name: 'Colombia', isFlagOfConvenience: false },

  // Comoros
  616: { code: 'KM', name: 'Comoros', isFlagOfConvenience: true },

  // Congo (DR)
  676: { code: 'CD', name: 'DR Congo', isFlagOfConvenience: true },

  // Cook Islands
  518: { code: 'CK', name: 'Cook Islands', isFlagOfConvenience: true },

  // Costa Rica
  321: { code: 'CR', name: 'Costa Rica', isFlagOfConvenience: false },

  // Croatia
  238: { code: 'HR', name: 'Croatia', isFlagOfConvenience: false },

  // Cuba
  323: { code: 'CU', name: 'Cuba', isFlagOfConvenience: false },

  // Cyprus
  209: { code: 'CY', name: 'Cyprus', isFlagOfConvenience: true },
  210: { code: 'CY', name: 'Cyprus', isFlagOfConvenience: true },
  212: { code: 'CY', name: 'Cyprus', isFlagOfConvenience: true },

  // Denmark
  219: { code: 'DK', name: 'Denmark', isFlagOfConvenience: false },
  220: { code: 'DK', name: 'Denmark', isFlagOfConvenience: false },

  // Djibouti
  621: { code: 'DJ', name: 'Djibouti', isFlagOfConvenience: true },

  // Dominican Republic
  325: { code: 'DO', name: 'Dominican Republic', isFlagOfConvenience: false },

  // Ecuador
  735: { code: 'EC', name: 'Ecuador', isFlagOfConvenience: false },

  // Egypt
  622: { code: 'EG', name: 'Egypt', isFlagOfConvenience: false },

  // Equatorial Guinea
  631: { code: 'GQ', name: 'Equatorial Guinea', isFlagOfConvenience: true },

  // Eritrea
  625: { code: 'ER', name: 'Eritrea', isFlagOfConvenience: false },

  // Estonia
  276: { code: 'EE', name: 'Estonia', isFlagOfConvenience: false },

  // Ethiopia
  624: { code: 'ET', name: 'Ethiopia', isFlagOfConvenience: false },

  // Finland
  230: { code: 'FI', name: 'Finland', isFlagOfConvenience: false },

  // France
  226: { code: 'FR', name: 'France', isFlagOfConvenience: false },
  227: { code: 'FR', name: 'France', isFlagOfConvenience: false },
  228: { code: 'FR', name: 'France', isFlagOfConvenience: false },

  // Gabon
  626: { code: 'GA', name: 'Gabon', isFlagOfConvenience: true },

  // Georgia
  213: { code: 'GE', name: 'Georgia', isFlagOfConvenience: true },

  // Germany
  211: { code: 'DE', name: 'Germany', isFlagOfConvenience: false },
  218: { code: 'DE', name: 'Germany', isFlagOfConvenience: false },

  // Ghana
  627: { code: 'GH', name: 'Ghana', isFlagOfConvenience: false },

  // Gibraltar
  236: { code: 'GI', name: 'Gibraltar', isFlagOfConvenience: true },

  // Greece
  237: { code: 'GR', name: 'Greece', isFlagOfConvenience: false },
  239: { code: 'GR', name: 'Greece', isFlagOfConvenience: false },
  240: { code: 'GR', name: 'Greece', isFlagOfConvenience: false },
  241: { code: 'GR', name: 'Greece', isFlagOfConvenience: false },

  // Honduras
  334: { code: 'HN', name: 'Honduras', isFlagOfConvenience: true },

  // Hong Kong
  477: { code: 'HK', name: 'Hong Kong', isFlagOfConvenience: false },

  // Iceland
  251: { code: 'IS', name: 'Iceland', isFlagOfConvenience: false },

  // India
  419: { code: 'IN', name: 'India', isFlagOfConvenience: false },

  // Indonesia
  525: { code: 'ID', name: 'Indonesia', isFlagOfConvenience: false },

  // Iran
  422: { code: 'IR', name: 'Iran', isFlagOfConvenience: false },

  // Iraq
  425: { code: 'IQ', name: 'Iraq', isFlagOfConvenience: false },

  // Ireland
  250: { code: 'IE', name: 'Ireland', isFlagOfConvenience: false },

  // Israel
  428: { code: 'IL', name: 'Israel', isFlagOfConvenience: false },

  // Italy
  247: { code: 'IT', name: 'Italy', isFlagOfConvenience: false },

  // Jamaica
  339: { code: 'JM', name: 'Jamaica', isFlagOfConvenience: false },

  // Japan
  431: { code: 'JP', name: 'Japan', isFlagOfConvenience: false },
  432: { code: 'JP', name: 'Japan', isFlagOfConvenience: false },

  // Jordan
  438: { code: 'JO', name: 'Jordan', isFlagOfConvenience: false },

  // Kenya
  634: { code: 'KE', name: 'Kenya', isFlagOfConvenience: false },

  // Kiribati
  529: { code: 'KI', name: 'Kiribati', isFlagOfConvenience: false },

  // North Korea
  445: { code: 'KP', name: 'North Korea', isFlagOfConvenience: false },

  // South Korea
  440: { code: 'KR', name: 'South Korea', isFlagOfConvenience: false },
  441: { code: 'KR', name: 'South Korea', isFlagOfConvenience: false },

  // Kuwait
  447: { code: 'KW', name: 'Kuwait', isFlagOfConvenience: false },

  // Latvia
  275: { code: 'LV', name: 'Latvia', isFlagOfConvenience: false },

  // Lebanon
  450: { code: 'LB', name: 'Lebanon', isFlagOfConvenience: true },

  // Liberia
  636: { code: 'LR', name: 'Liberia', isFlagOfConvenience: true },
  637: { code: 'LR', name: 'Liberia', isFlagOfConvenience: true },

  // Libya
  642: { code: 'LY', name: 'Libya', isFlagOfConvenience: false },

  // Lithuania
  277: { code: 'LT', name: 'Lithuania', isFlagOfConvenience: false },

  // Luxembourg
  253: { code: 'LU', name: 'Luxembourg', isFlagOfConvenience: true },

  // Malaysia
  533: { code: 'MY', name: 'Malaysia', isFlagOfConvenience: false },

  // Maldives
  455: { code: 'MV', name: 'Maldives', isFlagOfConvenience: false },

  // Malta
  215: { code: 'MT', name: 'Malta', isFlagOfConvenience: true },
  229: { code: 'MT', name: 'Malta', isFlagOfConvenience: true },
  249: { code: 'MT', name: 'Malta', isFlagOfConvenience: true },
  256: { code: 'MT', name: 'Malta', isFlagOfConvenience: true },

  // Marshall Islands
  538: { code: 'MH', name: 'Marshall Islands', isFlagOfConvenience: true },

  // Mauritania
  654: { code: 'MR', name: 'Mauritania', isFlagOfConvenience: false },

  // Mauritius
  645: { code: 'MU', name: 'Mauritius', isFlagOfConvenience: false },

  // Mexico
  345: { code: 'MX', name: 'Mexico', isFlagOfConvenience: false },

  // Moldova
  214: { code: 'MD', name: 'Moldova', isFlagOfConvenience: true },

  // Mongolia
  457: { code: 'MN', name: 'Mongolia', isFlagOfConvenience: true },

  // Montenegro
  262: { code: 'ME', name: 'Montenegro', isFlagOfConvenience: false },

  // Morocco
  242: { code: 'MA', name: 'Morocco', isFlagOfConvenience: false },

  // Mozambique
  650: { code: 'MZ', name: 'Mozambique', isFlagOfConvenience: false },

  // Myanmar
  506: { code: 'MM', name: 'Myanmar', isFlagOfConvenience: true },

  // Netherlands
  244: { code: 'NL', name: 'Netherlands', isFlagOfConvenience: false },
  245: { code: 'NL', name: 'Netherlands', isFlagOfConvenience: false },
  246: { code: 'NL', name: 'Netherlands', isFlagOfConvenience: false },

  // New Zealand
  512: { code: 'NZ', name: 'New Zealand', isFlagOfConvenience: false },

  // Nigeria
  657: { code: 'NG', name: 'Nigeria', isFlagOfConvenience: false },

  // Norway
  257: { code: 'NO', name: 'Norway', isFlagOfConvenience: false },
  258: { code: 'NO', name: 'Norway', isFlagOfConvenience: false },
  259: { code: 'NO', name: 'Norway', isFlagOfConvenience: false },

  // Oman
  461: { code: 'OM', name: 'Oman', isFlagOfConvenience: false },

  // Pakistan
  463: { code: 'PK', name: 'Pakistan', isFlagOfConvenience: false },

  // Palau
  511: { code: 'PW', name: 'Palau', isFlagOfConvenience: true },

  // Panama
  351: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  352: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  353: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  354: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  355: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  356: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  357: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  370: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  371: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  372: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },
  373: { code: 'PA', name: 'Panama', isFlagOfConvenience: true },

  // Peru
  760: { code: 'PE', name: 'Peru', isFlagOfConvenience: false },

  // Philippines
  548: { code: 'PH', name: 'Philippines', isFlagOfConvenience: false },

  // Poland
  261: { code: 'PL', name: 'Poland', isFlagOfConvenience: false },

  // Portugal
  263: { code: 'PT', name: 'Portugal', isFlagOfConvenience: false },

  // Qatar
  466: { code: 'QA', name: 'Qatar', isFlagOfConvenience: false },

  // Romania
  264: { code: 'RO', name: 'Romania', isFlagOfConvenience: false },

  // Russia
  273: { code: 'RU', name: 'Russia', isFlagOfConvenience: false },

  // Saint Kitts and Nevis
  341: { code: 'KN', name: 'Saint Kitts and Nevis', isFlagOfConvenience: true },

  // Saint Vincent and the Grenadines
  375: { code: 'VC', name: 'Saint Vincent and the Grenadines', isFlagOfConvenience: true },
  376: { code: 'VC', name: 'Saint Vincent and the Grenadines', isFlagOfConvenience: true },
  377: { code: 'VC', name: 'Saint Vincent and the Grenadines', isFlagOfConvenience: true },

  // Saudi Arabia
  403: { code: 'SA', name: 'Saudi Arabia', isFlagOfConvenience: false },

  // Senegal
  663: { code: 'SN', name: 'Senegal', isFlagOfConvenience: false },

  // Sierra Leone
  667: { code: 'SL', name: 'Sierra Leone', isFlagOfConvenience: true },

  // Singapore
  563: { code: 'SG', name: 'Singapore', isFlagOfConvenience: false },
  564: { code: 'SG', name: 'Singapore', isFlagOfConvenience: false },
  565: { code: 'SG', name: 'Singapore', isFlagOfConvenience: false },

  // Slovenia
  278: { code: 'SI', name: 'Slovenia', isFlagOfConvenience: false },

  // Somalia
  666: { code: 'SO', name: 'Somalia', isFlagOfConvenience: false },

  // South Africa
  601: { code: 'ZA', name: 'South Africa', isFlagOfConvenience: false },

  // Spain
  224: { code: 'ES', name: 'Spain', isFlagOfConvenience: false },
  225: { code: 'ES', name: 'Spain', isFlagOfConvenience: false },

  // Sri Lanka
  417: { code: 'LK', name: 'Sri Lanka', isFlagOfConvenience: true },

  // Sweden
  265: { code: 'SE', name: 'Sweden', isFlagOfConvenience: false },
  266: { code: 'SE', name: 'Sweden', isFlagOfConvenience: false },

  // Switzerland
  269: { code: 'CH', name: 'Switzerland', isFlagOfConvenience: false },

  // Syria
  468: { code: 'SY', name: 'Syria', isFlagOfConvenience: false },

  // Taiwan
  416: { code: 'TW', name: 'Taiwan', isFlagOfConvenience: false },

  // Tanzania
  674: { code: 'TZ', name: 'Tanzania', isFlagOfConvenience: true },

  // Thailand
  567: { code: 'TH', name: 'Thailand', isFlagOfConvenience: false },

  // Togo
  671: { code: 'TG', name: 'Togo', isFlagOfConvenience: true },

  // Tonga
  570: { code: 'TO', name: 'Tonga', isFlagOfConvenience: true },

  // Trinidad and Tobago
  362: { code: 'TT', name: 'Trinidad and Tobago', isFlagOfConvenience: false },

  // Tunisia
  672: { code: 'TN', name: 'Tunisia', isFlagOfConvenience: false },

  // Turkey
  271: { code: 'TR', name: 'Turkey', isFlagOfConvenience: false },

  // Tuvalu
  572: { code: 'TV', name: 'Tuvalu', isFlagOfConvenience: true },

  // UAE
  470: { code: 'AE', name: 'United Arab Emirates', isFlagOfConvenience: false },
  471: { code: 'AE', name: 'United Arab Emirates', isFlagOfConvenience: false },

  // UK
  232: { code: 'GB', name: 'United Kingdom', isFlagOfConvenience: false },
  233: { code: 'GB', name: 'United Kingdom', isFlagOfConvenience: false },
  234: { code: 'GB', name: 'United Kingdom', isFlagOfConvenience: false },
  235: { code: 'GB', name: 'United Kingdom', isFlagOfConvenience: false },

  // Ukraine
  272: { code: 'UA', name: 'Ukraine', isFlagOfConvenience: false },

  // Uruguay
  770: { code: 'UY', name: 'Uruguay', isFlagOfConvenience: false },

  // USA
  338: { code: 'US', name: 'United States', isFlagOfConvenience: false },
  366: { code: 'US', name: 'United States', isFlagOfConvenience: false },
  367: { code: 'US', name: 'United States', isFlagOfConvenience: false },
  368: { code: 'US', name: 'United States', isFlagOfConvenience: false },
  369: { code: 'US', name: 'United States', isFlagOfConvenience: false },

  // Vanuatu
  576: { code: 'VU', name: 'Vanuatu', isFlagOfConvenience: true },
  577: { code: 'VU', name: 'Vanuatu', isFlagOfConvenience: true },

  // Venezuela
  775: { code: 'VE', name: 'Venezuela', isFlagOfConvenience: false },

  // Vietnam
  574: { code: 'VN', name: 'Vietnam', isFlagOfConvenience: false },

  // Yemen
  473: { code: 'YE', name: 'Yemen', isFlagOfConvenience: false },
};

const UNKNOWN_FLAG: FlagInfo = {
  code: 'XX',
  name: 'Unknown',
  isFlagOfConvenience: false,
};

/**
 * Extract the MID (Maritime Identification Digit) from an MMSI.
 * The MID is the first 3 digits of a 9-digit MMSI.
 */
function extractMID(mmsi: number): number {
  const mmsiStr = mmsi.toString().padStart(9, '0');
  return parseInt(mmsiStr.substring(0, 3), 10);
}

/**
 * Decode the flag state from an MMSI number.
 */
export function decodeFlagFromMMSI(mmsi: number): FlagInfo {
  const mid = extractMID(mmsi);
  return MID_TO_COUNTRY[mid] ?? UNKNOWN_FLAG;
}

/**
 * Check if a given country code is a flag of convenience.
 */
export function isFlagOfConvenience(countryCode: string): boolean {
  return FLAGS_OF_CONVENIENCE.has(countryCode.toUpperCase());
}

/**
 * Get the ISO country code from an MMSI.
 */
export function getCountryCode(mmsi: number): string {
  return decodeFlagFromMMSI(mmsi).code;
}
