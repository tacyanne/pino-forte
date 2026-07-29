ALTER TABLE `service_orders` ADD `customer_type` text DEFAULT 'Cliente final' NOT NULL;
--> statement-breakpoint
UPDATE `service_orders`
SET `customer_type` = COALESCE(
  (
    SELECT `customers`.`customer_type`
    FROM `customers`
    WHERE TRIM(LOWER(`customers`.`name`)) = TRIM(LOWER(`service_orders`.`customer_name`))
    LIMIT 1
  ),
  'Cliente final'
);
--> statement-breakpoint
UPDATE `service_orders`
SET
  `subtotal` = CASE WHEN `subtotal` > 0 THEN `subtotal` ELSE `total` END,
  `discount_rate` = CASE
    WHEN `quantity` >= 20 THEN 10
    WHEN `quantity` >= 10 THEN 8
    ELSE 5
  END,
  `total` = ROUND(
    (CASE WHEN `subtotal` > 0 THEN `subtotal` ELSE `total` END) *
    (CASE
      WHEN `quantity` >= 20 THEN 0.90
      WHEN `quantity` >= 10 THEN 0.92
      ELSE 0.95
    END),
    2
  )
WHERE TRIM(LOWER(`customer_type`)) = 'distribuidor'
  AND `discount_rate` = 0;
