import type { ObjectIcon } from "@/shared";
import { BookOpen, Box, Briefcase, CalendarDays, Car, Heart, Home, Tag, Truck, Wrench, type LucideIcon } from "lucide-react";

/** Menu icons for custom sections */
export const OBJECT_ICON: Record<ObjectIcon, LucideIcon> = { box: Box, car: Car, home: Home, book: BookOpen, briefcase: Briefcase, wrench: Wrench, calendar: CalendarDays, tag: Tag, truck: Truck, heart: Heart };
export const objectIcon = (icon: string) => OBJECT_ICON[icon as ObjectIcon] ?? Box;
