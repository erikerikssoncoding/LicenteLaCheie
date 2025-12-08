ALTER TABLE ticket_replies
    ADD COLUMN message_id VARCHAR(255) DEFAULT NULL,
    ADD UNIQUE KEY ticket_replies_message_id_unique (message_id);
