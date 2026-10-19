import React from 'react';

/** 4-step progress bar for room booking. The details form moves it to step 4 on the client via data-current. */
export function BookingSteps({ lang, current }: { lang: string; current: 1 | 2 | 3 | 4 | 5 | number }) {
  const ar = lang === 'ar';
  const steps = ar ? ['التواريخ', 'الغرفة', 'بياناتك', 'الدفع'] : ['Dates', 'Room', 'Details', 'Payment'];
  return (
    <ol className="bk-steps" id="bk-steps" data-current={current} aria-label={ar ? 'خطوات الحجز' : 'Booking steps'}>
      {steps.map((s, i) => (
        <li key={s} data-n={i + 1} aria-current={current === i + 1 ? 'step' : undefined}>
          <span className="bk-dot num">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
