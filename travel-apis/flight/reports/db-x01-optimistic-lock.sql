-- X01 / V094 / V095 — optimistic lock on booking_item
USE travelx;

SET @br := 'BR1786538901965364';

SELECT bi.id AS booking_item_id, bi.version AS version_before, b.booking_reference
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br;

SELECT bi.id, bi.version INTO @bi_id, @v
FROM booking_item bi
JOIN booking b ON b.id = bi.booking_id
WHERE b.booking_reference = @br
LIMIT 1;

SELECT @bi_id AS booking_item_id, @v AS version_read_by_A_and_B;

-- V094 Writer A
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS writer_A_rows_affected;
SELECT id, version AS version_after_A FROM booking_item WHERE id = @bi_id;

-- V095 Writer B (stale @v)
UPDATE booking_item SET version = version + 1 WHERE id = @bi_id AND version = @v;
SELECT ROW_COUNT() AS writer_B_rows_affected;
SELECT id, version AS version_final FROM booking_item WHERE id = @bi_id;
