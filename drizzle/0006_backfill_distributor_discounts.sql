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
  ),
  `received` = MIN(
    `received`,
    ROUND(
      (CASE WHEN `subtotal` > 0 THEN `subtotal` ELSE `total` END) *
      (CASE
        WHEN `quantity` >= 20 THEN 0.90
        WHEN `quantity` >= 10 THEN 0.92
        ELSE 0.95
      END),
      2
    )
  )
WHERE `discount_rate` = 0
  AND EXISTS (
    SELECT 1
    FROM `customers`
    WHERE TRIM(LOWER(`customers`.`name`)) = TRIM(LOWER(`service_orders`.`customer_name`))
      AND `customers`.`customer_type` = 'Distribuidor'
  );
