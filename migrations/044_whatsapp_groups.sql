-- A WhatsApp group per event (and per collab event), shown on its page. The villa's community link is a setting.
ALTER TABLE events ADD COLUMN IF NOT EXISTS whatsapp_group text;
ALTER TABLE collabs ADD COLUMN IF NOT EXISTS whatsapp_group text;
