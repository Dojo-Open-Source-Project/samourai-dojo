# SQL scripts for incremental updates

# Copyright © 2019 – Katana Cryptographic Ltd. All Rights Reserved.

--
-- Update table "banned_addresses"
--
ALTER TABLE `banned_addresses`
MODIFY COLUMN `addrAddress` varchar(74) NOT NULL;
