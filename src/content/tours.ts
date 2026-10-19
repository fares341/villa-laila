// Day trips listed on the hostel's own website (villalaylahostel.com). Booked through WhatsApp; no prices published.
const C = 'https://images.ctfassets.net/s5z2pi209yg7/';
export const TOURS: { key: 'fayoum' | 'desert' | 'giza' | 'saqqara' | 'nile' | 'islamic' | 'alex'; img: string | null }[] = [
  { key: 'giza', img: C + '3DJebg55cnIsigGN5SSqoj/fe6dadcbfe7c008dd8b9c863c3b460a4/grand.avif?fm=webp&q=75&w=800' },
  { key: 'desert', img: C + '4sfRmDam2dqub2kjTdlsb9/a471d01ec6a5808247c8982cf8c400b4/white-dessert-egypt.png?fm=webp&q=75&w=800' },
  { key: 'saqqara', img: C + '22GeA20Xa0ydCOQI1VsEds/2d42dda3296f18514ce6f4b22fef1673/Sakkara_Image-by-DEZALB-from-Pixabay.jpg?fm=webp&q=75&w=800' },
  { key: 'islamic', img: C + '7HEsQCvA8hSRpkwbGIoiBj/8116a044f46916626382d038514cd587/Sultan_Hassan_Mosque___Madrasa.jpg?fm=webp&q=75&w=800' },
  { key: 'alex', img: C + '3G72STgPqbKRbTk1rkdHii/2c2d6452af53fe1748fec19a5d62e671/Qaitbay_Citadel.jpg?fm=webp&q=75&w=800' },
  { key: 'fayoum', img: null },
  { key: 'nile', img: null },
];
