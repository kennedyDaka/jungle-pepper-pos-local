import { menuService } from "@/services/menuService";

export const productsService = {
  listCategories: menuService.listCategories,
  listProducts: menuService.listMenuItems,
  listModifiers: menuService.listModifiers,
  saveProduct: menuService.saveMenuItem,
  deleteProduct: menuService.deleteMenuItem,
};
