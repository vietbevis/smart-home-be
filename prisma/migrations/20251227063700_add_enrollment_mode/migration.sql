/*
  Warnings:

  - You are about to drop the column `isActive` on the `rfidcard` table. All the data in the column will be lost.
  - You are about to drop the column `rfidCardId` on the `user` table. All the data in the column will be lost.
  - Added the required column `updatedAt` to the `RfidCard` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `door` ADD COLUMN `enrollmentMode` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `enrollmentUserId` INTEGER NULL,
    MODIFY `name` VARCHAR(191) NOT NULL DEFAULT 'Main Door';

-- AlterTable
ALTER TABLE `rfidcard` DROP COLUMN `isActive`,
    ADD COLUMN `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ALTER COLUMN `userId` DROP DEFAULT;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `rfidCardId`;
