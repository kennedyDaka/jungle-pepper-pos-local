-- Wine is stocked as 750 ml bottles but sold by 175 ml glass, not 50 ml spirit shots.
update public.items
set shot_ml = 175,
    updated_at = now()
where active
  and name in (
    'DROSTDY WINE BOTTLE',
    'OVERMEER WINE BOTTLE',
    'RED SWEET WINE BOTTLE',
    'WHITE WINE BOTTLE'
  );
