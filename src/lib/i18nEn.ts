// Angleški slovar kot en sam kos, ki se naloži šele, ko je izbran angleški jezik
// (i18n.ts → loadEn). Prej so bili slovarji (60 kB) v začetnem paketu tudi za
// slovenske uporabnike (analiza hitrosti 09.11.2026).
type Dict = Record<string, string>;
const modules = import.meta.glob<{ default: Dict }>('./i18n/en/*.ts', { eager: true });
const EN: Dict = Object.assign({}, ...Object.values(modules).map(m => m.default));
export default EN;
