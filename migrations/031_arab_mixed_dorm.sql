-- Mixed dorms: closed to Egyptian AND Arab nationals (owner instruction). Widens the existing rule.
UPDATE policy_rules SET
  name = 'Egyptian and Arab nationals cannot book MIXED dorms',
  conditions = '[{"op":"in","field":"nationality","value":["DZ","BH","KM","DJ","EG","IQ","JO","KW","LB","LY","MR","MA","OM","PS","QA","SA","SO","SD","SY","TN","AE","YE"]},{"op":"eq","field":"room_kind","value":"dorm"},{"op":"eq","field":"room_gender","value":"mixed"}]'::jsonb,
  message = '{"key":"dorm","en":"Sorry, mixed dormitories can''t be booked by Egyptian or Arab nationals. Please choose a private room, a women-only or men-only dorm, or contact reception.","ar":"عذرًا، لا يمكن للمصريين والجنسيات العربية حجز الغرف المشتركة المختلطة. من فضلك اختر غرفة خاصة أو غرفة مشتركة للبنات أو للشباب، أو تواصل مع الاستقبال.","es":"Lo sentimos, los dormitorios mixtos no pueden ser reservados por ciudadanos egipcios o árabes.","fr":"Désolé, les dortoirs mixtes ne peuvent pas être réservés par des ressortissants égyptiens ou arabes."}'::jsonb,
  version = version + 1, updated_at = now()
WHERE name = 'Egyptian nationals cannot book MIXED dorms';
