import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { createVuetify } from 'vuetify'

export default createVuetify({
  theme: { defaultTheme: 'light' },
  defaults: { VBtn: { variant: 'tonal' }, VCard: { variant: 'outlined' } },
})
