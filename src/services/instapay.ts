/**
 * InstaPay (Egypt) — manual transfer. The guest sends the money from their bank app to the hostel's InstaPay address,
 * then types the transfer reference on the site. Nothing is marked paid until a manager checks the InstaPay app
 * and verifies it in Dashboard → Events & payments.
 *
 *   INSTAPAY_ADDRESS="villalayla@instapay"   (InstaPay payment address, IPA)
 *   INSTAPAY_PHONE="01xxxxxxxxx"             (optional: mobile number linked to InstaPay)
 *   INSTAPAY_NAME="Villa Layla"              (account name the guest will see)
 *   INSTAPAY_LINK="https://ipn.eg/S/…"       (optional: InstaPay payment link)
 */
export const instapay = {
  get address() { return process.env.INSTAPAY_ADDRESS || ''; },
  get phone() { return process.env.INSTAPAY_PHONE || ''; },
  get name() { return process.env.INSTAPAY_NAME || 'Villa Layla Hostel'; },
  get link() { return process.env.INSTAPAY_LINK || ''; },
};

export function instapayEnabled(currency?: string): boolean {
  if (!(instapay.address || instapay.phone)) return false;
  return !currency || currency.toUpperCase() === 'EGP';
}

export function instapayDetails() {
  return { address: instapay.address, phone: instapay.phone, name: instapay.name, link: instapay.link };
}
