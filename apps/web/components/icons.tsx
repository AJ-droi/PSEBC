/** Stroke icons (decorative unless labelled by their control). */
type P = { size?: number };
const base = (size: number) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true });

export const Back = ({ size = 22 }: P) => <svg {...base(size)}><path d="M15 18l-6-6 6-6" /></svg>;
export const Plus = ({ size = 22 }: P) => <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>;
export const Phone = ({ size = 20 }: P) => <svg {...base(size)}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>;
export const Shield = ({ size = 16 }: P) => <svg {...base(size)} strokeWidth={2.4}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
export const Check = ({ size = 14 }: P) => <svg {...base(size)} strokeWidth={3}><path d="M20 6L9 17l-5-5" /></svg>;
export const Bell = ({ size = 22 }: P) => <svg {...base(size)}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
export const Car = ({ size = 20 }: P) => <svg {...base(size)}><path d="M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3z" /><circle cx="7.5" cy="13.5" r="1" /><circle cx="16.5" cy="13.5" r="1" /></svg>;
export const Alert = ({ size = 20 }: P) => <svg {...base(size)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>;
