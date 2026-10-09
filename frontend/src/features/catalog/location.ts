// Links for the salon's address (the Location page and the home "Visit us" section). Google
// Maps search URLs need no API key; the embed is a plain iframe of the same search.
export const directionsUrl = (address: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export const mapEmbedUrl = (address: string): string =>
  `https://maps.google.com/maps?q=${encodeURIComponent(address)}&z=15&output=embed`;
