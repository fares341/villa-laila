import { redirect } from 'next/navigation';
// Products, stock and stock movements now live in Catalog & stock (used live by the POS).
export default function Inventory() { redirect('/dashboard/catalog'); }
