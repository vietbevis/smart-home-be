-- Add userId column to User for rfidCard relation
ALTER TABLE `User` ADD COLUMN `rfidCardId` INTEGER NULL;

-- Add userId column to DoorAccessLog
ALTER TABLE `DoorAccessLog` ADD COLUMN `userId` INTEGER NULL;

-- Drop old constraints on RfidCard
ALTER TABLE `RfidCard` DROP FOREIGN KEY `RfidCard_doorId_fkey`;
ALTER TABLE `RfidCard` DROP INDEX `RfidCard_doorId_uidHash_key`;

-- Modify RfidCard table
ALTER TABLE `RfidCard` DROP COLUMN `name`;
ALTER TABLE `RfidCard` ADD COLUMN `userId` INTEGER NOT NULL DEFAULT 1;
ALTER TABLE `RfidCard` ADD UNIQUE INDEX `RfidCard_userId_key`(`userId`);
ALTER TABLE `RfidCard` ADD UNIQUE INDEX `RfidCard_uid_key`(`uid`);
ALTER TABLE `RfidCard` ADD UNIQUE INDEX `RfidCard_uidHash_key`(`uidHash`);

-- Add foreign keys
ALTER TABLE `RfidCard` ADD CONSTRAINT `RfidCard_doorId_fkey` FOREIGN KEY (`doorId`) REFERENCES `Door`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RfidCard` ADD CONSTRAINT `RfidCard_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DoorAccessLog` ADD CONSTRAINT `DoorAccessLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
