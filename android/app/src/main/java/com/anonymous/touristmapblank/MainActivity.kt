package com.anonymous.touristmapblank

import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    // expo-splash-screen teması super.onCreate'ten ÖNCE
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "main"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    // Expo sarmalayıcısı olmadan vanilla RN delegate
    return object : DefaultReactActivityDelegate(
      this,
      mainComponentName,
      // RN 0.75+ → property (parantez yok)
      DefaultNewArchitectureEntryPoint.fabricEnabled
    ) {}
  }

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
