package com.anonymous.touristmapblank

import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

// R referansı için (paketinizle aynı isimde)
import com.anonymous.touristmapblank.R

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // expo-splash-screen için onCreate'ten ÖNCE tema ayarı
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }

  /** JS tarafında AppRegistry.registerComponent ile verilen ana bileşen adı */
  override fun getMainComponentName(): String = "main"

  /**
   * New Architecture bayraklarını DefaultReactActivityDelegate ile kontrol eder.
   * ReactActivityDelegateWrapper (expo) ile sarmalayıp döndürüyoruz.
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(
        this,
        mainComponentName,
        // ⬇⬇ import karmaşasına girmemek için tam nitelikli çağrı
        com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled()
      ) {}
    )
  }

  /**
   * Android S (API 31) geri tuşu davranışı ile hizalama.
   */
  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
