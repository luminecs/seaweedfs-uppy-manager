<!-- src/App.vue -->
<template>
  <div class="min-h-screen bg-gray-100">
    <nav class="bg-white shadow-md">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center">
            <span class="font-bold text-xl text-gray-800">
              <router-link to="/">SeaweedFS Manager</router-link>
            </span>
          </div>
          <div class="flex space-x-4">
<!--            <router-link to="/" class="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200" active-class="bg-gray-200 text-gray-900">
              Generic Upload
            </router-link>-->
<!--            <router-link to="/" class="px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200" active-class="bg-gray-200 text-gray-900">-->
<!--              Buckets-->
<!--            </router-link>-->
          </div>
        </div>
      </div>
    </nav>

    <main>
      <div class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <router-view></router-view>
      </div>
    </main>
  </div>
</template>

<script setup>
</script>
