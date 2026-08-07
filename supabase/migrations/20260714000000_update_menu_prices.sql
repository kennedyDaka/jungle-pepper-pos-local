-- Update menu prices to new price list

-- Starters
update public.menu_items set price = 15800 where name = 'Garlic Loaf';
update public.menu_items set price = 16800 where name = 'Garlic Loaf and Cheese';
update public.menu_items set price = 26800 where name = 'Focaccia';
update public.menu_items set price = 39800 where name = 'Focaccia and Cheese';

-- Salads
update public.menu_items set price = 15500 where name = 'Greek Salad';

-- Pastas (all shapes)
update public.menu_items set price = 29900 where name like '%Pomodoro';
update public.menu_items set price = 29900 where name like '%Picanti';
update public.menu_items set price = 29800 where name like '%Bolognese';
update public.menu_items set price = 29800 where name like '%Creamy Chicken and Mushroom';
update public.menu_items set price = 39800 where name like '%Creamy Tomato and Prawn';

-- Pizza - Beef
update public.menu_items set price = 39800 where name = 'Katundu Pizza';
update public.menu_items set price = 39800 where name = 'Mexicano Pizza';

-- Pizza - Chicken
update public.menu_items set price = 39800 where name = 'Portuguese Chicken Pizza';
update public.menu_items set price = 39800 where name = 'Chicken Mushroom Pizza';
update public.menu_items set price = 39800 where name = 'Sweet and Sour Safari Pizza';
update public.menu_items set price = 39800 where name = 'Maffiosa Pizza';

-- Pizza - Fish
update public.menu_items set price = 41800 where name = 'Prawn Pizza';
update public.menu_items set price = 39800 where name = 'Anchovy Pizza';

-- Pizza - Vegetarian & specialty
update public.menu_items set price = 39800 where name = 'Vegetarian Pizza';
update public.menu_items set price = 39800 where name = 'Vegan Pizza';
update public.menu_items set price = 39800 where name = 'Margarita Pizza';
update public.menu_items set price = 39800 where name = 'Piccanti Pizza';
update public.menu_items set price = 39800 where name = 'Jalapeno Pizza';
update public.menu_items set price = 39800 where name = 'Hummus Pizza';
update public.menu_items set price = 39800 where name = 'Godfather Pizza';
update public.menu_items set price = 39800 where name = 'Mediterranean Pizza';

-- Burgers
update public.menu_items set price = 29800 where name = 'Jungle Pepper Burger';
update public.menu_items set price = 29800 where name = 'Chicken Burger';
update public.menu_items set price = 36800 where name = 'Prawn Burger';
update public.menu_items set price = 29800 where name = 'Veggie Burger';

-- Chips
update public.menu_items set price = 13800 where name = 'Plain Chips Small';
update public.menu_items set price = 14800 where name = 'Plain Chips Large';
update public.menu_items set price = 14800 where name = 'Masala Chips Small';
update public.menu_items set price = 16800 where name = 'Masala Chips Large';

-- Pregos & Bitoques
update public.menu_items set price = 32800 where name = 'Plain Prego';
update public.menu_items set price = 32800 where name = 'Prego Pimento';
update public.menu_items set price = 37900 where name = 'Beef Bitoque';
update public.menu_items set price = 37900 where name = 'Chicken Bitoque';

-- Frango (Churrasco)
update public.menu_items set price = 42800 where name = 'Half Churrasco Chicken';
update public.menu_items set price = 62800 where name = 'Full Churrasco Chicken';

-- Seafood
update public.menu_items set price = 69800 where name = 'Arroz de Marisco';
update public.menu_items set price = 50800 where name = 'Camarao 6 Prawns';
update public.menu_items set price = 69800 where name = 'Camarao 12 Prawns';

-- Coffee & Tea
update public.menu_items set price = 9500 where name = 'Italian Cappuccino';
update public.menu_items set price = 9500 where name = 'Brazilian Cappuccino';
update public.menu_items set price = 7500 where name = 'Bica Espresso';
update public.menu_items set price = 10500 where name = 'Railway Espresso Bombom';
update public.menu_items set price = 7500 where name = 'Carioca';
update public.menu_items set price = 7500 where name = 'Macchiato';
update public.menu_items set price = 7500 where name = 'Pingo';
update public.menu_items set price = 7500 where name = 'Babychino';
update public.menu_items set price = 10500 where name = 'Galao Caffe Latte';
update public.menu_items set price = 14000 where name = 'Hot Chocolate';
update public.menu_items set price = 10500 where name = 'Submarine';
update public.menu_items set price = 12500 where name = 'Chocachino';
update public.menu_items set price = 10500 where name = 'Filter Coffee';
update public.menu_items set price = 5000 where name = 'Malawian Tea';
update public.menu_items set price = 8000 where name = 'Rooibos Tea';
update public.menu_items set price = 7000 where name = 'Carioca de Limao';
update public.menu_items set price = 8000 where name = 'Herbal Teas';

-- Ensure Extra Chicken Topping is 8000
update public.menu_items set price = 8000 where name = 'Extra Chicken Topping';
