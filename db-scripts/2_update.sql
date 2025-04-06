# SQL scripts for incremental updates

# Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.

--
-- Update table "banned_addresses"
--
ALTER TABLE `banned_addresses`
MODIFY COLUMN `addrAddress` varchar(74) NOT NULL;

--
-- Create table "api_keys"
--
CREATE TABLE IF NOT EXISTS `api_keys` (
    `apikeyID`  INT AUTO_INCREMENT PRIMARY KEY,
    `label`     VARCHAR(100) NOT NULL,
    `apikey`    VARCHAR(100) NOT NULL UNIQUE KEY,
    `active`    BOOLEAN DEFAULT TRUE,
    `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `expiresAt` TIMESTAMP NOT NULL
);
