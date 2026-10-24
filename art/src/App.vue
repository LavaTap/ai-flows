<script setup lang="ts">
import { theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'

const themeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#7c8cff',
    colorInfo: '#7c8cff',
    colorBgBase: '#0b0d14',
    colorBgContainer: '#12141d',
    colorBorder: '#252a3a',
    colorText: '#e8eaf3',
    colorTextSecondary: '#9aa1b8',
    borderRadius: 10,
    controlHeight: 34,
    fontFamily:
      "Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, sans-serif",
  },
}
</script>

<template>
  <a-config-provider :theme="themeConfig" :locale="zhCN">
    <router-view />
  </a-config-provider>
</template>
