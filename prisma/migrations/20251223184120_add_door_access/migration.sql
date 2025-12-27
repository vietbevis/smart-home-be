-- CreateTable
CREATE TABLE `Door` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `pinHash` VARCHAR(191) NOT NULL,
    `isOnline` BOOLEAN NOT NULL DEFAULT false,
    `lastSeen` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RfidCard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doorId` VARCHAR(191) NOT NULL,
    `uid` VARCHAR(191) NOT NULL,
    `uidHash` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RfidCard_doorId_uidHash_key`(`doorId`, `uidHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DoorAccessLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `doorId` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `rfidUid` VARCHAR(191) NULL,
    `method` VARCHAR(191) NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RfidCard` ADD CONSTRAINT `RfidCard_doorId_fkey` FOREIGN KEY (`doorId`) REFERENCES `Door`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DoorAccessLog` ADD CONSTRAINT `DoorAccessLog_doorId_fkey` FOREIGN KEY (`doorId`) REFERENCES `Door`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
