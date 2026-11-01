'use client';

import React, { useEffect, useState } from 'react';

/** The "I'm coming" bar at the bottom of the phone: shown once the top button has scrolled away, hidden at the form. */
export function StickyCta({ label }: { label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => {
      const top = document.querySelector('.cb-cta')?.getBoundingClientRect();
      const form = document.getElementById('join')?.getBoundingClientRect();
      const topGone = !!top && top.bottom < 0;
      const atForm = !!form && form.top < window.innerHeight - 80 && form.bottom > 0;
      setShow(topGone && !atForm);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return <a className={`cb-sticky${show ? ' on' : ''}`} href="#join" aria-hidden={!show} tabIndex={show ? 0 : -1}>{label}</a>;
}
