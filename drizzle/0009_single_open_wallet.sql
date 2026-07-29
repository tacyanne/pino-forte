ALTER TABLE `service_orders` ADD `wallet_month` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `service_orders`
SET `wallet_month` = SUBSTR(`created_at`, 1, 7)
WHERE `payment_method` = 'Carteira';
--> statement-breakpoint
UPDATE `service_orders`
SET `wallet_month` = (
  SELECT SUBSTR(MIN(`open_orders`.`created_at`), 1, 7)
  FROM `service_orders` AS `open_orders`
  WHERE
    LOWER(TRIM(`open_orders`.`customer_name`)) = LOWER(TRIM(`service_orders`.`customer_name`))
    AND `open_orders`.`payment_method` = 'Carteira'
    AND `open_orders`.`received` < `open_orders`.`total`
    AND `open_orders`.`production_status` <> 'Cancelada'
)
WHERE
  `payment_method` = 'Carteira'
  AND `received` < `total`
  AND `production_status` <> 'Cancelada';
