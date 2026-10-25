import type { Component } from 'vue'
import {
  AimOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  CompassOutlined,
  ExpandOutlined,
  FormOutlined,
  FormatPainterOutlined,
  PictureOutlined,
  ScissorOutlined,
  SlidersOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
  ZoomInOutlined,
} from '@ant-design/icons-vue'

/** 能力清单里的 icon 是组件名，这里集中映射成真实的图标组件 */
const ICON_MAP: Record<string, Component> = {
  FormOutlined,
  PictureOutlined,
  SlidersOutlined,
  ScissorOutlined,
  ZoomInOutlined,
  ApartmentOutlined,
  ExpandOutlined,
  CompassOutlined,
  FormatPainterOutlined,
  AimOutlined,
  VideoCameraOutlined,
  AppstoreOutlined,
}

export function aiIconOf(name: string): Component {
  return ICON_MAP[name] ?? ThunderboltOutlined
}
